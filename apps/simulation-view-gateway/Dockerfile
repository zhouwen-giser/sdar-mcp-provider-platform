ARG PYTHON_IMAGE=python@sha256:5be5aaecb962a41567bc8041f1e9e3432cb085b037fe057f9a562630b2e4b370
FROM ${PYTHON_IMAGE}
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY apps/simulation-view-gateway/requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir --no-deps --require-hashes -r /app/requirements.txt
COPY apps/simulation-view-gateway/view_gateway.py /app/view_gateway.py
ENTRYPOINT ["python", "/app/view_gateway.py"]
CMD ["--config", "/run/config/simulation-view.json"]
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="SMPP project-owned simulation view" org.opencontainers.image.version="1.4.0" org.opencontainers.image.revision="${VCS_REF}"
USER 1000:1000
