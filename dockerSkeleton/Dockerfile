FROM ubuntu:20.04

ENV FLASK_PROXY_PORT 8080
ARG DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Vancouver
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/4.00/tessdata

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
 && pip3 install gevent Flask \
 # Cleanup package files
 && apt-get clean autoclean \
 && apt-get autoremove -y \
 && rm -rf /var/lib/{apt,dpkg,cache,log}

RUN mkdir -p /actionProxy
ADD actionproxy.py /actionProxy/

RUN mkdir -p /action
ADD parse-check-with-ocr.sh /action/exec
RUN chmod +x /action/exec

ADD tessdata/mcr2.traineddata /usr/share/tesseract-ocr/4.00/tessdata/

CMD ["/bin/bash", "-c", "cd actionProxy && python3 -u actionproxy.py"]