# Deployment

The controlled path is **local → tests → isolated staging → validation → eventual PR**. Phase 0 ends after local validation and a reviewable PR; there is no production deployment. Wrangler deploy commands are forbidden in Phase 0. Staging later requires separately provisioned V2-only D1, R2/assets, event, preview, and Worker resources plus replacement of the fake UUID. A production environment requires a separate isolation review and deliberately is not configured.
