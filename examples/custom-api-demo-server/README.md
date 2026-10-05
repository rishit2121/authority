# Custom API demo server

A tiny, deployable, zero-dependency HTTP server for live-testing Authority's Custom API connector against a real HTTPS endpoint -- not a fixture. Every "order" is fixed, disposable demo data (ids `4821`, `4822`); there is no write endpoint and no database, so there is nothing real to break.

## Run locally

```
DEMO_BEARER_TOKEN=some-random-string npm start
```

## Deploy (optional, for a real public HTTPS endpoint)

This is a separate, independent Render service -- unrelated to the main `authority` service.

1. Render -> New -> Blueprint -> point at this directory's `render.yaml`.
2. Fill in `DEMO_BEARER_TOKEN` (any random string) when prompted.
3. Deploy. Your URL is `https://custom-api-demo-server-<suffix>.onrender.com`.

## Register it as a Custom API connection in Authority

Settings -> Integrations -> Custom API -> new connection:

- Base URL: your deployed URL (or `http://localhost:8787` for local testing)
- Auth type: Bearer, value = your `DEMO_BEARER_TOKEN`

Then publish one operation:

- Method: `GET`
- Path template: `/v1/orders/{orderId}`
- Effect: `read`
- Input field: `orderId` (string, required, identifies the resource)

Delegate the connection to a customer, then run it through the shared runner:

```
cd ../connector-quickstart
CUSTOM_API_TOOL=<the published tool name, e.g. custom_xxxxx.get_order> \
CUSTOM_API_OPERATION=get_order \
CUSTOM_API_RESOURCE=4821 \
CUSTOM_API_ARGS_JSON='{"orderId":"4821"}' \
npm run custom-api
```
