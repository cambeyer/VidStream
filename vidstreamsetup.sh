#!/bin/bash
sudo apt-get update
sudo apt-get -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" dist-upgrade
curl -sL https://deb.nodesource.com/setup | sudo bash -
sudo apt-get install nodejs build-essential git
git clone https://github.com/cambeyer/VidStream.git
cd ~/Vidstream
sudo npm install
sudo add-apt-repository ppa:kirillshkrogalev/ffmpeg-next
sudo apt-get update
sudo apt-get install ffmpeg
sudo echo "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDbAF49Cs+o7T5tWjVCeEPXWfJIVe+zSL2PnSgqRM4H1TbQxR11pcBojPuuLnE50L0sS2Xj8x8uFr2cWPtkcE5k5p0quMqwFxA2WMo5JBrkxkVbOjRk1kw3R+2mgvbPLdliFGE1UAKIYbwXHRv2amF/G1QSpQK7zKVyYpQ/wV3oc0fxpRJcxAo9hBLRqtC/A41ycFWRljFp8vcK6jqWiIaqdbQ0Let2C3pSBs1KRRz0FzzzSIn7XqWYyR7WVYErN1DGsyjLECXxAIzUs+EuXFAPmtFV8QVQtdNbrQwq708cZQhqXNTpH+48/y8XTmowV8/vKEJ41+uINdqG14K+C9XV cam.beyer@gmail.com" >> ~/.ssh/authorized_keys
curl -L https://raw.githubusercontent.com/c9/install/master/install.sh | sudo bash