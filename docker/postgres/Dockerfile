ARG POSTGRES_IMAGE=postgres:18.6-trixie
FROM ${POSTGRES_IMAGE}
COPY docker/postgres/init/10-roles.sh /docker-entrypoint-initdb.d/10-roles.sh
