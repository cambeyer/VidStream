var express = require('express');
var app = express();
var busboy = require('connect-busboy');
var path = require('path');
var fs = require('fs-extra');
var http = require('http').Server(app);
var io = require('socket.io')(http);
var crypto = require('crypto');
var node_cryptojs = require('node-cryptojs-aes');
var CryptoJS = node_cryptojs.CryptoJS;
var ffmpeg = require('fluent-ffmpeg');
var nedb = require('nedb');
var jsrp = require('jsrp');
var atob = require('atob');

//set the directory where files are served from and uploaded to
var dir = __dirname + '/files/';

app.use(busboy());

//files in the public directory can be directly queried for via HTTP
app.use(express.static(path.join(__dirname, 'public')));

var processing = {};
var done = [];

var userKeys = {};
var verifiers = {};

var playing = {};

var db = {};
db.users = new nedb({ filename: dir + "users.db", autoload: true });
db.users.persistence.setAutocompactionInterval(200000);
db.users.ensureIndex({ fieldName: 'username', unique: true });

app.route('/upload').post(function (req, res, next) {
	var hash = crypto.createHash('md5');
	var md5;
	req.busboy.on('file', function (fieldname, stream, name) {
		console.log("Uploading file: " + name);
		var filename = dir + path.basename(name);
		var fstream = fs.createWriteStream(filename);
		stream.on('data', function (chunk) {
			hash.update(chunk);
		});
		fstream.on('close', function () {
			md5 = hash.digest('hex');
			res.writeHead(200, { Connection: 'close' });
      		res.end(md5);

			ffmpeg(filename)
				.videoBitrate('1024k')
				.videoCodec('libx264')
				.fps(30)
				.audioBitrate('128k')
				.audioCodec('aac')
				.audioChannels(2)
				.format('mp4')
				.outputOption('-pix_fmt yuv420p')
				.outputOption('-movflags faststart')
				.outputOption('-analyzeduration 2147483647')
				.outputOption('-probesize 2147483647')
				.on('start', function (cmdline) {
					console.log("File uploaded; beginning transcode");
				})
				.on('progress', function (progress) {
					if (processing[md5]) {
						processing[md5].emit('progress', progress.percent);
					} else if (progress.percent > 50) {
						console.log("Transcoding without a client listener (>50%)");
					}
					//console.log('Transcoding: ' + progress.percent + '% done');
				})
				.on('end', function () {
					if (processing[md5]) {
						processing[md5].emit('progress', 100);
						delete processing[md5];
						console.log('File has been transcoded successfully: ' + md5);
					} else {
						done.push(md5);
						console.log("Completed without ever receiving a listener");
					}
					fs.unlinkSync(filename); //remove the initially uploaded file... could retain this for auditing purposes
				})
				.on('error', function (err, stdout, stderr) {
					console.log("Transcoding issue: " + err + stderr);
				})
				.save(dir + md5 + ".mp4");
		});
		stream.pipe(fstream);
	});
	req.busboy.on('finish', function () {
		//processing form complete
	});
	req.pipe(req.busboy);
});

app.get('/download', function (req, res){
	var encryptedName = atob(req.query.file);
	var filename = decrypt(req.query.username, req.query.session, encryptedName);
	var hashed = crypto.createHash('md5').update(filename + req.query.session).digest('hex');
	var verifier = verifiers[hashed] ? parseInt(decrypt(req.query.username, req.query.session, atob(verifiers[hashed])), 10): 0;
	if (filename) {

		if (!playing[encryptedName]) {
			playing[encryptedName] = {};
			playing[encryptedName].verifier = -1;
		}
		if (verifier > playing[encryptedName].verifier) {
			playing[encryptedName].verifier = verifier;
			playing[encryptedName].lastVerified = Date.now();
		} else {
			if (verifier < playing[encryptedName].verifier || Date.now() - playing[encryptedName].lastVerified > 5000) {
				//if we haven't received a range request with an updated verifier in the last 5 seconds, stop the request
				res.sendStatus(401);
				return;
			} else {
				//it's a request with a recent verification so we let it through
			}
		}

		var file = path.resolve(dir, filename);
		if (req.headers.range) {
			var range = req.headers.range;
			var positions = range.replace(/bytes=/, "").split("-");
			var start = parseInt(positions[0], 10);

			fs.stat(file, function (err, stats) {
				if (err) {
					return;
				}
				var total = stats.size;
				//console.log("Request for partial file: " + filename + "; size: " + (total / Math.pow(2, 20)).toFixed(1) + " MB");
				var end = positions[1] ? parseInt(positions[1], 10) : total - 1;

				var chunksize = (end - start) + 1;

				res.writeHead(206, {
					"Content-Range": "bytes " + start + "-" + end + "/" + total,
					"Accept-Ranges": "bytes",
					"Content-Length": chunksize,
					"Content-Type": "video/mp4"
				});

				try {
					var stream = fs.createReadStream(file, { start: start, end: end })
					.on("open", function () {
						stream.pipe(res);
					}).on("error", function (err) {
						try {
							res.end(err);
						} catch (e) {
							console.log("Error streaming out.");
						}
					});
				} catch (e) {
					console.log("Error streaming out.");
				}
			});
		} else {
			fs.stat(file, function (err, stats) {
				if (err) {
					return;
				}
				var total = stats.size;
				//console.log("Request for whole file: " + filename + "; size: " + (total / Math.pow(2, 20)).toFixed(1) + " MB");

				res.writeHead(200, {
					'Content-Length': total,
					"Accept-Ranges": "bytes",
					'Content-Type': 'video/mp4',
				});
				try {
					var stream = fs.createReadStream(file)
					.on("open", function () {
						stream.pipe(res);
					}).on("error", function (err) {
						try {
							res.end(err);
						} catch (e) {
							console.log("Error streaming out.");
						}
					});
				} catch (e) {
					console.log("Error streaming out.");
				}
			});
		}
	} else {
		res.sendStatus(401);
	}
});

var createSRPResponse = function (socket, user) {
	var srpServer = new jsrp.server();
	srpServer.init({ salt: user.salt, verifier: user.verifier }, function () {
		srpServer.setClientPublicKey(user.publicKey);
		var srpMsg = {};
		srpMsg.salt = srpServer.getSalt();
		srpMsg.publicKey = srpServer.getPublicKey();
		var sessionNumber = Date.now().toString();
		if (!userKeys[user.username]) {
			userKeys[user.username] = {keys: []};
		}
		var key = {};
		key.content = srpServer.getSharedKey();
		key.sessionNumber = sessionNumber;
		key.verified = false;
		userKeys[user.username].keys.push(key);
		srpMsg.encryptedPhrase = encrypt(user.username, sessionNumber, sessionNumber, true);
		socket.emit('login', srpMsg);
	});
};

var getKey = function (username, sessionNumber) {
	var key;
	for (var i = 0; i < userKeys[username].keys.length; i++) {
		if (userKeys[username].keys[i].sessionNumber < Date.now() - 86400000) { //24 hour timeout
			userKeys[username].keys.splice(i, 1);
			i--;
			continue;
		}
		if (!key && userKeys[username].keys[i].sessionNumber == sessionNumber) {
			key = userKeys[username].keys[i];
		}
	}
	return key;
};

var decrypt = function (username, sessionNumber, text, disregardVerification) {
	var key = getKey(username, sessionNumber);
	if (key) {
		try {
			if (disregardVerification || key.verified) {
				return CryptoJS.AES.decrypt(text, key.content).toString(CryptoJS.enc.Utf8);
			}
		} catch (e) { }
	}
};

var encryptedPhrases = {};

var encrypt = function(username, sessionNumber, text, disregardVerification) {
	var key = getKey(username, sessionNumber);
	if (key) {
		try {
			if (disregardVerification || key.verified) {
				if (!encryptedPhrases[username]) {
					encryptedPhrases[username] = {};
				}
				if (!encryptedPhrases[username][sessionNumber]) {
					encryptedPhrases[username][sessionNumber] = {};
				}
				if (!encryptedPhrases[username][sessionNumber][text]) {
					encryptedPhrases[username][sessionNumber][text] = CryptoJS.AES.encrypt(text, key.content).toString();
				}
				return encryptedPhrases[username][sessionNumber][text];
			}
		} catch (e) { }
	}
};

io.on('connection', function (socket) {
	socket.on('subscribe', function (md5) {
		console.log("Subscription from client for processing updates " + md5);
		for (var i = 0; i < done.length; i++) {
			if (done[i] == md5) {
				console.log("File finished transcoding before client subscription; sending success");
				socket.emit('progress', 100);
				done.splice(i, 1);
				return;
			}
		}
		processing[md5] = socket;
		socket.emit('progress', 0);
	});
	socket.on('new', function (newUser) {
		var userObj = {};
		userObj.username = newUser.username;
		userObj.salt = newUser.salt;
		userObj.verifier = newUser.verifier;
		db.users.insert(userObj, function (err) {
			if (!err) {
				console.log("Registered new user: " + newUser.username);
				userObj.publicKey = newUser.publicKey;
				createSRPResponse(socket, userObj);
			} else {
				console.log("DB insert error");
			}
		});
	});
	socket.on('login', function (srpObj) {
		db.users.findOne({ username: srpObj.username }, function (err, userObj) {
			if (!err) {
				if (!userObj) {
					socket.emit('new');
				} else {
					userObj.publicKey = srpObj.publicKey;
					createSRPResponse(socket, userObj);
				}
			} else {
				console.log("DB lookup error");
			}
		});
	});
	socket.on('verify', function (challenge) {
		if (userKeys[challenge.username]) {
			if (decrypt(challenge.username, challenge.sessionNumber, challenge.encryptedPhrase, true) == "client") {
				console.log("Successfully logged in user: " + challenge.username);
				getKey(challenge.username, challenge.sessionNumber).verified = true;
			} else {
				console.log("Failed login for user: " + challenge.username);
			}
		}
	});
	socket.on('keepalive', function(pingObj) {
		verifiers[pingObj.hashed] = pingObj.value;
	});
});

http.listen(8888, "0.0.0.0", function (){
	console.log('listening on *:8888');
});