FROM jaredallard/triton-base:latest

WORKDIR /stack/

# Only install deps when we need to
COPY --chown=999:999 package.json yarn.lock /stack/
RUN yarn --production=true --frozen-lockfile

COPY --chown=999:999 . /stack