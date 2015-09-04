/*global angular*/
angular.module('VidStreamApp', ['VidStreamApp.controllers', 'VidStreamApp.directives', 'ngAnimate']);

//main Angular module
angular.module('VidStreamApp.controllers', ['ngCookies']).controller('mainController', function($scope, $rootScope, $interval, $timeout, $cookies, $document, $window) {

	$scope.progress = false;
	$scope.uploadPercent = 0;
	$scope.processPercent = 0;

	$scope.authed = false;
	$scope.authing = false;
	$scope.loading = false;

	$scope.confirmPassword = false;
	$scope.hash = "";

	$scope.fields = {
		username: "",
		password: "",
		passwordConfirm: ""
	};

	//initialize the Socket.IO environment
	/*global io*/
	$scope.socket = io();

	$document.ready(function(){
		$('#username').focus();
	});

	$scope.logout = function() {
		$cookies.remove('username');
		$cookies.remove('hash');
		$window.location.reload();
	};

	$scope.uploadFile = function() {
		var oData = new FormData();
		oData.append("file", document.getElementById("file").files[0]);
		var oReq = new XMLHttpRequest();
		oReq.upload.addEventListener('progress', function(e) {
			$scope.$apply(function () {
				$scope.uploadPercent = Math.floor(e.loaded / e.total * 100).toFixed(0);
			});
		}, false);
		oReq.open("post", "upload", true);
		oReq.responseType = "text";
		oReq.onreadystatechange = function() {
			if (oReq.readyState == 4 && oReq.status == 200) {
				$scope.socket.emit('subscribe', oReq.response);
				$scope.$apply(function () {
					$scope.uploadPercent = 0;
				});
			} else if (oReq.readyState == 4 && oReq.status !== 200) {
				alert("There was an error uploading your file");
			}
		}
		$("#file").prop('disabled', true);
		$("#upload").prop('disabled', true);
		$scope.progress = true;
		oReq.send(oData);
	}

	$scope.socket.on('reconnect', function(num) {
		$scope.login();
	});

	$scope.resetControls = function() {
		$scope.confirmPassword = false;
		$scope.fields.passwordConfirm = "";
		$scope.fields.username = $scope.fields.username.replace(/\W/g, '');
	};

	$scope.login = function() {
		if ($scope.fields.username && ($scope.fields.password || $scope.hash)) {
			$scope.authing = true;
			$scope.loading = true;
			$scope.error = false;
			if ($scope.confirmPassword) {
				if ($scope.fields.passwordConfirm == $scope.fields.password) {
					alert("Welcome to VidStream; your account will now be created.");
					$scope.sendEncrypted($scope.tempKey);
					$scope.confirmPassword = false;
				} else {
					alert("Your passwords do not match. Please try again.");
					$scope.fields.password = "";
					$scope.fields.passwordConfirm = "";
					$scope.authing = false;
					$scope.loading = false;
					$timeout(function() {
						$('#password').focus();
					}, 0, false);
				}
			} else {
				$scope.socket.emit('login', $scope.fields.username);
			}
		}
	};

	$scope.socket.on('encrypt', function (requestObj) {
		if ($scope.authing) {
			if (requestObj.newUser) {
				//alert("Please confirm your password to create your account.");
				$scope.$apply(function () {
					$scope.confirmPassword = true;
					$scope.loading = false;
					$scope.tempKey = requestObj.publicKey;
				});
				$('#confirm').focus();
			} else {
				$scope.sendEncrypted(requestObj.publicKey);
			}
		} else {
			//Hacking attempt detected
		}
	});

	$scope.sendEncrypted = function(publicKey) {
		/*global JSEncrypt*/
		var encryptor = new JSEncrypt();
		encryptor.setPublicKey(publicKey);
		var response = {};
		response.username = $scope.fields.username;
		if (!$scope.hash) {
			/*global CryptoJS*/
			$scope.hash = CryptoJS.MD5($scope.fields.password).toString();
		}
		response.message = encryptor.encrypt($scope.hash);
		$scope.socket.emit('encrypt', response);
	};

	$scope.socket.on('login', function (successBool) {
		$scope.$apply(function () {
			$scope.authing = false;
			$scope.loading = false;
			$scope.authed = successBool;
			if (!$scope.authed) {
				$scope.error = true;
				$scope.hash = "";
				$scope.fields.password = "";
			} else {
				$scope.error = false;
				$cookies.put('username', $scope.fields.username);
				$cookies.put('hash', $scope.hash);
				$scope.fields.password = "";
				//token?
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
		$scope.hash = $cookies.get('hash');
		$scope.login();
	}
});