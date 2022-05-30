FROM ubuntu:18.04

ENV FLASK_PROXY_PORT 8080
ARG DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Vancouver

# Upgrade and install basic Python dependencies
RUN apt-get update \
 && apt-get install -y \
    bzip2 \
    gcc \
    libc6-dev \
    python3-pip \
    python-dev \
    build-essential \
    curl \
    jq \
    tesseract-ocr \
 && pip3 install gevent flask \
 # Cleanup package files
 && apt-get clean autoclean \
 && apt-get autoremove -y \
 && rm -rf /var/lib/{apt,dpkg,cache,log}/

RUN mkdir -p /actionProxy
ADD actionproxy.py /actionProxy/

RUN mkdir -p /action
ADD parse-check-with-ocr.sh /action/exec
RUN chmod +x /action/exec

ADD tessdata /usr/share/tesseract-ocr/tessdata/

CMD ["/bin/bash", "-c", "cd actionProxy && python -u actionproxy.py"]