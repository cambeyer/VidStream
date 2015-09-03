var express = require('express');
var app = express();
var busboy = require('connect-busboy');
var path = require('path');
var fs = require('fs-extra');
var http = require('http').Server(app);
var io = require('socket.io')(http);
var crypto = require('crypto');
var ffmpeg = require('fluent-ffmpeg');
/*
//Code for AD
var ActiveDirectory = require('activedirectory');

var domain = "na1.ford.com";
var domainController = "ECCNA109.na1.ford.com";

var ad = new ActiveDirectory({ url: 'ldap://' + domainController, baseDN: 'dc=na1,dc=ford,dc=com' });
*/

//set the directory where files are served from and uploaded to
var dir = __dirname + '/files/';

app.use(busboy());

//files in the public directory can be directly queried for via HTTP
app.use(express.static(path.join(__dirname, 'public')));

var processing = {};
var done = [];

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
					console.log("Transcoding issue: " + stderr);
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
	socket.on('login', function(userObj) {
		if (userObj.username) {
			socket.emit('encrypt', "-----BEGIN PUBLIC KEY----- MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDlOJu6TyygqxfWT7eLtGDwajtN FOb9I5XRb6khyfD1Yt3YiCgQWMNW649887VGJiGr/L5i2osbl8C9+WJTeucF+S76 xFxdU6jE0NQ+Z+zEdhUTooNRaY5nZiu5PgDB0ED/ZKBUSLKL7eibMxZtMlUDHjm4 gwQco1KRMDSmXSMkDwIDAQAB -----END PUBLIC KEY-----");
		} else {
			socket.emit('login', false);
		}
	});
	socket.on('encrypt', function(encrypted) {
		socket.emit('login', true);
	});
});

http.listen(8888, "0.0.0.0", function(){
	console.log('listening on *:8888');
});