var express = require('express');
var app = express();
var busboy = require('connect-busboy');
var path = require('path');
var fs = require('fs-extra');
var http = require('http').Server(app);
var io = require('socket.io')(http);
var crypto = require('crypto');
var node_cryptojs = require('node-cryptojs-aes');
var ffmpeg = require('fluent-ffmpeg');
var Datastore = require('nedb');
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

var playing = {};

var CryptoJS = node_cryptojs.CryptoJS;

var db = {};
db.users = new Datastore({ filename: dir + "users.db", autoload: true });
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
	if (filename) {

		if (!playing[encryptedName]) {
			playing[encryptedName] = {};
			playing[encryptedName]["ranges"] = [];
		}

		var ranges = playing[encryptedName].ranges;

		var file = path.resolve(dir, filename);
		if (req.headers.range) {
			var range = req.headers.range;
			var positions = range.replace(/bytes=/, "").split("-");
			var start = parseInt(positions[0], 10);
			var current = start;

			fs.stat(file, function (err, stats) {
				if (err) {
					return;
				}
				var total = stats.size;
				console.log("Request for partial file: " + filename + "; size: " + (total / Math.pow(2, 20)).toFixed(1) + " MB");
				var end = positions[1] ? parseInt(positions[1], 10) : total - 1;
				end = end - start > 900000 ? start + 900000 : end; /////////

				var activeRange;
				for (var i = 0; i < ranges.length; i++) {
					if (start >= ranges[i].start && start < ranges[i].end) {
						/*
						start = ranges[i].end;
						current = start;
						if (end <= ranges[i].end) {
							console.log("Sending 304");
							res.setHeader("ETag", filename);
							res.setHeader("Cache-Control", "private, max-age=432000000");
							res.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + total);
							res.sendStatus(304);
							return;
							end = start + 900000;
						}
						*/
						activeRange = ranges[i];
						break;
					}
				}

				var chunksize = (end - start) + 1;

				res.writeHead(206, {
					"Content-Range": "bytes " + start + "-" + end + "/" + total,
					"Accept-Ranges": "bytes",
					"Content-Length": chunksize,
					"Content-Type": "video/mp4",
					"Cache-Control": "private, max-age=432000000",
					"Last-Modified": stats.mtime,
					"ETag": filename
				});

				var stream = fs.createReadStream(file, { start: start, end: end })
				.on("data", function (chunk) {
					current = current + chunk.length;

					if (!activeRange) {
						var tempRange = {};
						tempRange.start = start;
						tempRange.end = current;
						var pushed = false;
						for (var i = 0; i < ranges.length; i++) {
							if (start < ranges[i].start) {
								ranges.splice(i, 0, tempRange);
								activeRange = ranges[i];
								pushed = true;
								break;
							}
						}
						if (!pushed) {
							ranges.push(tempRange);
							activeRange = ranges[ranges.length - 1];
						}
					} else {
						if (current > activeRange.end) {
							activeRange.end = current;
						} else {
							console.log("Duplicate request.");
						}
					}
					for (var i = 0; i < ranges.length - 1; i++) {
						if (ranges[i].end >= ranges[i + 1].start) {
							ranges[i].end = ranges[i + 1].end;
							ranges.splice(i + 1, 1);
							if (start >= ranges[i].start && start < ranges[i].end) {
								activeRange = ranges[i];
								break;
							}
							i--;
						}
					}
					console.log(JSON.stringify(ranges));
				}).on("open", function () {
					stream.pipe(res);
				}).on("error", function (err) {
					try {
						res.end(err);
					} catch (e) {
						console.log("Error streaming out.");
					}
				});
			});
		} else {
			fs.stat(file, function (err, stats) {
				if (err) {
					return;
				}
				var total = stats.size;
				console.log("Request for whole file: " + filename + "; size: " + (total / Math.pow(2, 20)).toFixed(1) + " MB");

				res.writeHead(200, {
					'Content-Length': total,
					"Accept-Ranges": "bytes",
					'Content-Type': 'video/mp4'
				});
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
			});
		}
	} else {
		res.send(401, 'Not a valid user or session.');
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
		srpMsg.encryptedPhrase = CryptoJS.AES.encrypt(sessionNumber, srpServer.getSharedKey()).toString();
		var key = {};
		key.content = srpServer.getSharedKey();
		key.sessionNumber = sessionNumber;
		key.verified = false;
		userKeys[user.username].keys.push(key);
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
});

http.listen(8888, "0.0.0.0", function (){
	console.log('listening on *:8888');
});