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

//set the directory where files are served from and uploaded to
var dir = __dirname + '/files/';

app.use(busboy());

//files in the public directory can be directly queried for via HTTP
app.use(express.static(path.join(__dirname, 'public')));

var processing = {};
var done = [];
var userKeys = {};

var CryptoJS = node_cryptojs.CryptoJS;

var db = {};
db.users = new Datastore({ filename: dir + "users.db", autoload: true });
db.users.persistence.setAutocompactionInterval(200000);
db.users.ensureIndex({ fieldName: 'username', unique: true });

//var userDB = { yes: { salt: 'fqvw8eglcw12dkqo43fq6qd81', hash: '7f05c6fa7f0c72fe9b8f33ddd23fbe74d54d92e4cefc6aceea2941fb0dee37ebc962d1d9ca23f2b5867c9887242c9ef2fa813614e67b9864f37b4c87876675ce65cde948175238df90b4ed368fbe3187edfc6cc8ccd1c10bfaa2eee0066da8ce90d2e500255e3e110a10ae92a6656634711bf54cc62e67e807ae7ca0afdd9cae54f4c5139da2d06cdd77e11e10eb15092172677e5c1267dd7fd96c976f472a3f728b460f70fb236877c1ca0e3bfaebd521ee3e43c97e1639040c423237bd6ef50545eb1f1f73f86eeb6fc167f291406bda6a314e80eeabfc5975c13067a17c1ecc17cbc922046c74299f676804301b06f674e0d858b06533bc4429b4999d6c42c5f62899949e5162913cf1b319aa8bf35729b973606c048cf0ecde7eb81976172fa056dff09fbecbee4bf6cc3a12b4875486b3e7982a1265d6c0a3397136948976736e382629b4c4af802d9b0c6879236930bbc7d49ddac328a9ce99e7911bdb3db9cbb03f98e4bf4968f7f757da5510b0529a127ab48e256c4121f7ecbb0b4da2a0fdd3c6c116e0760429d097b307275ccc8884e7bc15e29724be876bd4545a0856eae71dce2272a2615e955b0a3b5afba36f20738815fa0bdd67514b09e34d3da25d69bcd20321e4077fc055690a1d012ac53c18c071b20a06a02c36c27ce1e17fc2c76862dad6716d5beed7af9f466cdf897931fb5af69fa2a9cec027fe5d' }};

app.route('/upload').post(function (req, res, next) {
	var hash = crypto.createHash('md5');
	var md5;
	req.busboy.on('file', function (fieldname, stream, name) {
		console.log("Uploading file: " + name);
		var filename = dir + path.basename(name);
		var fstream = fs.createWriteStream(filename);
		stream.on('data', function(chunk) {
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
				.on('start', function(cmdline) {
					console.log("File uploaded; beginning transcode");
				})
				.on('progress', function(progress) {
					if (processing[md5]) {
						processing[md5].emit('progress', progress.percent);
					} else if (progress.percent > 50) {
						console.log("Transcoding without a client listener (>50%)");
					}
					//console.log('Transcoding: ' + progress.percent + '% done');
				})
				.on('end', function() {
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
				.on('error', function(err, stdout, stderr) {
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

app.get('/download', function(req, res){
	var file = path.resolve(dir, req.query.file);
	if (req.headers.range) {
		var range = req.headers.range;
		var positions = range.replace(/bytes=/, "").split("-");
		var start = parseInt(positions[0], 10);

		fs.stat(file, function(err, stats) {
			if (err) {
				return;
			}
			var total = stats.size;
			console.log("Request for partial file: " + req.query.file + "; size: " + (total / Math.pow(2, 20)).toFixed(1) + " MB");
			var end = positions[1] ? parseInt(positions[1], 10) : total - 1;
			var chunksize = (end - start) + 1;

			res.writeHead(206, {
				"Content-Range": "bytes " + start + "-" + end + "/" + total,
				"Accept-Ranges": "bytes",
				"Content-Length": chunksize,
				"Content-Type": "video/mp4"
			});

			var stream = fs.createReadStream(file, { start: start, end: end })
			.on("open", function() {
				stream.pipe(res);
			}).on("error", function(err) {
				try {
					res.end(err);
				} catch (e) {
					console.log("Error streaming out.");
				}
			});
		});
	} else {
		fs.stat(file, function(err, stats) {
			if (err) {
				return;
			}
			var total = stats.size;
			console.log("Request for whole file: " + req.query.file + "; size: " + (total / Math.pow(2, 20)).toFixed(1) + " MB");

			res.writeHead(200, {
				'Content-Length': total,
				"Accept-Ranges": "bytes",
				'Content-Type': 'video/mp4'
			});
			var stream = fs.createReadStream(file)
			.on("open", function() {
				stream.pipe(res);
			}).on("error", function(err) {
				try {
					res.end(err);
				} catch (e) {
					console.log("Error streaming out.");
				}
			});
		});
	}
});

var createSRPResponse = function(socket, user) {
	var srpServer = new jsrp.server();
	srpServer.init({ salt: user.salt, verifier: user.verifier }, function () {
		srpServer.setClientPublicKey(user.publicKey);
		var srpMsg = {};
		srpMsg.salt = srpServer.getSalt();
		srpMsg.publicKey = srpServer.getPublicKey();
		srpMsg.encryptedPhrase = CryptoJS.AES.encrypt('server', srpServer.getSharedKey()).toString();
		userKeys[user.username] = {};
		userKeys[user.username].key = srpServer.getSharedKey();
		userKeys[user.username].verified = false;
		socket.emit('login', srpMsg);
	});
};

io.on('connection', function(socket) {
	socket.on('subscribe', function(md5) {
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
	socket.on('new', function(newUser) {
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
	socket.on('login', function(srpObj) {
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
	socket.on('verify', function(challenge) {
		if (userKeys[challenge.username]) {
			try {
				if (CryptoJS.AES.decrypt(challenge.encryptedPhrase, userKeys[challenge.username].key).toString(CryptoJS.enc.Utf8) !== "client") {
					delete userKeys[challenge.username];
					console.log("Failed login for user: " + challenge.username);
				} else {
					console.log("Successfully logged in user: " + challenge.username);
					userKeys[challenge.username].verified = true;
				}
			} catch (e) {
				delete userKeys[challenge.username];
				console.log("Failed login for user: " + challenge.username);
			}
		}
	});
});

http.listen(8888, "0.0.0.0", function(){
	console.log('listening on *:8888');
});