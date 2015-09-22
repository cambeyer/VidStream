/*global angular*/
angular.module('VidStreamApp', ['VidStreamApp.controllers', 'VidStreamApp.directives', 'ngAnimate']);

//main Angular module
angular.module('VidStreamApp.controllers', ['ngCookies']).controller('mainController', function ($scope, $rootScope, $interval, $timeout, $cookies, $document, $window, $sce) {

	$scope.progress = false;
	$scope.uploadPercent = 0;
	$scope.processPercent = 0;

	$scope.activeVideo = 'c2a5a4338214ae3956f65d27d81fc591.mp4';

	$scope.authed = false;
	$scope.loading = false;

	$scope.confirmPassword = false;

	/*global jsrp*/
	$scope.srpClient = new jsrp.client();
	$scope.srpObj = {};

	$scope.sessionNumber = 0;
	$scope.videoFile;
	$scope.encryptedPhrases = {};

	$scope.fields = {
		username: "",
		password: "",
		passwordConfirm: ""
	};

	//initialize the Socket.IO environment
	/*global io*/
	$scope.socket = io();

	$document.ready(function (){
		$('#username').focus();
		if ($scope.fields.username) {
			$('#password').focus();
		}
	});

	$scope.logout = function () {
		$cookies.remove('username');
		$window.location.reload();
	};

	$scope.uploadFile = function () {
		var oData = new FormData();
		oData.append("file", document.getElementById("file").files[0]);
		var oReq = new XMLHttpRequest();
		oReq.upload.addEventListener('progress', function (e) {
			$scope.$apply(function () {
				$scope.uploadPercent = Math.floor(e.loaded / e.total * 100).toFixed(0);
			});
		}, false);
		oReq.open("post", "upload", true);
		oReq.responseType = "text";
		oReq.onreadystatechange = function () {
			if (oReq.readyState == 4 && oReq.status == 200) {
				$scope.socket.emit('subscribe', oReq.response);
				$scope.$apply(function () {
					$scope.uploadPercent = 0;
				});
			} else if (oReq.readyState == 4 && oReq.status !== 200) {
				alert("There was an error uploading your file");
			}
		};
		$("#file").prop('disabled', true);
		$("#upload").prop('disabled', true);
		$scope.progress = true;
		oReq.send(oData);
	};

	$scope.socket.on('reconnect', function (num) {
		$scope.login();
	});

	$scope.resetControls = function () {
		$scope.confirmPassword = false;
		$scope.fields.passwordConfirm = "";
		$scope.fields.username = $scope.fields.username.replace(/\W/g, '');
	};

	$scope.encrypt = function (text) {
		if (!$scope.encryptedPhrases[text]) {
			$scope.encryptedPhrases[text] = CryptoJS.AES.encrypt(text, $scope.srpClient.getSharedKey()).toString();
		}
		return $scope.encryptedPhrases[text];
	};

	$scope.videoString = function (videoFile) {
		if ($scope.fields.username && $scope.sessionNumber) {
			$scope.videoFile = videoFile;
			/*global btoa*/
			return $sce.trustAsResourceUrl("./download?" + "username=" + $scope.fields.username + "&session=" + $scope.sessionNumber + "&file=" + btoa($scope.encrypt($scope.videoFile)));
		}
	};

	$interval(function() {
		if ($scope.videoFile && $scope.sessionNumber) {
			var pingObj = {};
			pingObj.hashed = CryptoJS.MD5($scope.videoFile + $scope.sessionNumber).toString();
			pingObj.value = btoa($scope.encrypt(Date.now().toString()).toString());
			$scope.socket.emit('keepalive', pingObj);
		}
	}, 1000);

	$scope.login = function () {
		if ($scope.fields.username && $scope.fields.password) {
			$scope.loading = true;
			if (!$scope.confirmPassword) {
				/*global CryptoJS*/
				$scope.srpClient.init({ username: $scope.fields.username, password: CryptoJS.MD5($scope.fields.password).toString() }, function () {
					$scope.srpObj = {};
					$scope.srpObj.username = $scope.fields.username;
					$scope.srpObj.publicKey = $scope.srpClient.getPublicKey();
					$scope.socket.emit('login', $scope.srpObj);
				});
			} else {
				if ($scope.fields.passwordConfirm == $scope.fields.password) {
					$scope.srpClient.createVerifier(function (err, result) {
						if (!err) {
							$scope.srpObj.salt = result.salt;
							$scope.srpObj.verifier = result.verifier;
							$scope.socket.emit('new', $scope.srpObj);
						} else {
							console.log("Error creating verifier.");
						}
				    });
				} else {
					alert("Your passwords do not match.  Please try again.");
					$scope.fields.passwordConfirm = "";
					$scope.fields.password = "";
					$("#password").focus();
				}
			}
		}
	};

	$scope.socket.on('new', function () {
		$scope.$apply(function () {
			$scope.loading = false;
			$scope.confirmPassword = true;
		});
		$('#confirm').focus();
	});

	$scope.socket.on('login', function (srpResponse) {
		$scope.srpClient.setSalt(srpResponse.salt);
		$scope.srpClient.setServerPublicKey(srpResponse.publicKey);
		try {
			$scope.sessionNumber = CryptoJS.AES.decrypt(srpResponse.encryptedPhrase, $scope.srpClient.getSharedKey()).toString(CryptoJS.enc.Utf8);
		} catch (e) { }
		var successBool = (!isNaN($scope.sessionNumber) && $scope.sessionNumber > 0);
		//console.log("Successfully established session: " + $scope.sessionNumber);
		$scope.$apply(function () {
			$scope.loading = false;
			$scope.authed = successBool;
			if (!$scope.authed) {
				$scope.error = true;
				$scope.fields.password = "";
			} else {
				$scope.error = false;
				$cookies.put('username', $scope.fields.username);
				//$scope.fields.password = "";

				$(".player").flowplayer({
					fullscreen: true,
					native_fullscreen: true,
				    clip: {
				        sources: [
				              { type: "video/mp4",
				                src:  $scope.videoString($scope.activeVideo) }
				        ]
				    }
				});

				$('.fp-embed').remove();
				$('.fp-brand').remove();
				$('a[href*="flowplayer"]').remove();
				$('.fp-context-menu').addClass('hidden');
				$('.fp-volume').css('right', '40px');

				var challenge = {};
				challenge.username = $scope.fields.username;
				challenge.sessionNumber = $scope.sessionNumber;
				challenge.encryptedPhrase = $scope.encrypt('client');
				$scope.socket.emit('verify', challenge);
				//load list of videos from the server
			}
		});
	});

	$scope.socket.on('progress', function (msg){
		$scope.$apply(function () {
			$scope.processPercent = Math.floor(msg).toFixed(0);
			if ($scope.processPercent >= 100) {
				try {
					$scope.progress = false;
					$scope.processPercent = 0;
					$("#file").prop('disabled', false);
					$("#upload").prop('disabled', false);
					$("#file").replaceWith($("#file").clone());
				} catch (e) {}
			}
		});
	});

	//Perform after all of the functions have been defined

	if ($cookies.get('username')) {
		$scope.fields.username = $cookies.get('username');
	}
});