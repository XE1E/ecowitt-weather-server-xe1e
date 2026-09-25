# Provisionamiento de Grafana (opcional)

`docker-compose.yml` monta esta carpeta en `/etc/grafana/provisioning` del contenedor
de Grafana (perfil `grafana`: `docker compose --profile grafana up -d`). Antes la
carpeta no existía en el repo y Docker la creaba vacía y de root.

Aquí van, si se quieren, las fuentes de datos y tableros que Grafana carga al arrancar:
`datasources/*.yaml` (p. ej. la conexión a InfluxDB) y `dashboards/*.yaml` + sus JSON.
Ver https://grafana.com/docs/grafana/latest/administration/provisioning/
