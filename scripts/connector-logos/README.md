# Connector logo sources

Brand marks for declarative REST connectors that Simple Icons doesn't carry. `scripts/generate-connector-logos.mts`
turns each into `public/logos/<id>.svg` (raster files are embedded in a small SVG wrapper). Every logo is a trademark
of its owner, used only to identify the service; see `THIRD_PARTY_NOTICES.md`.

- **From svgl.app** (`https://svgl.app/library/…`): apollo, attio, heroku, openai, twilio.
- **From each company's own site icon** (its published favicon / touch icon, fetched once at the largest size
  available): activecampaign, affinity, amplitude, ashby, bamboohr, calcom, capsule, chargebee, close_crm, copper, crisp,
  customer_io, deel, freshdesk and freshsales (both Freshworks), front, gong, gorgias, harvest, jotform, klaviyo, kustomer,
  launchdarkly, lever, mailjet, mercury, monday, pinecone, pipedrive, postmark, pylon, recurly, salesloft, sendgrid
  (Twilio SendGrid), smartsheet, streak, typeform, workable, wrike.

SVGs here must contain no script, event handler, `foreignObject`, embedded image or external reference; the generator
refuses one that does. To replace a mark, drop the owner's official file here under the connector id and rerun the
generator.
