#!/bin/bash
#
# This script will build the docker image and push it to dockerhub.
#
# Usage: buildAndPush.sh imageName
#
# Dockerhub image names look like "username/appname" and must be all lower case.
# For example, "janesmith/calculator"

IMAGE_NAME=$1
echo "Using $IMAGE_NAME as the image name"

# Make the docker image
docker build -t $IMAGE_NAME .
if [ $? -ne 0 ]; then
    echo "Docker build failed"
    exit
fi

docker tag $IMAGE_NAME:latest $IMAGE_NAME:0.0.1

docker push $IMAGE_NAME:0.0.1
if [ $? -ne 0 ]; then
    echo "Docker push failed"
    exit
fi

