FROM browseruse/browseruse:0.13.7

WORKDIR /opt/skye-browser
COPY --chown=browseruse:browseruse browser-worker/worker.py ./worker.py

USER browseruse
EXPOSE 8765

ENTRYPOINT ["python", "/opt/skye-browser/worker.py"]
