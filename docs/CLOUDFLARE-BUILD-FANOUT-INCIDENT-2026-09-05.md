# Cloudflare Cross-Project Build Fanout — 2026-09-05

## Observation
Commits on `ceo/revenue-attribution-preview`, whose intended scope is Fiji Dash attribution preview work, triggered Cloudflare build activity for unrelated projects including:
- `vakaviti-marketplace-stage1` (Workers build, failed)
- `vakaviti-lagi-public` (Pages build observed in progress)

## Risk
A repository-wide Git integration can cause unrelated Cloudflare projects to build from branches/commits that do not belong to those applications. Even when a build fails safely, this creates noise and weakens the isolation assumptions used for release engineering. If a project is configured to publish preview/production from an overly broad branch rule, an unrelated commit could create an unintended deployment.

## Immediate control
- Do not make further implementation commits on the attribution branch until the build fanout is mapped.
- Do not interpret these Cloudflare bot comments as authorisation to deploy attribution.
- No production D1 migration or nadi-dispatch-api Worker deployment is authorised.
- Keep PR #49 draft.

## Audit required
For every Cloudflare project linked to `jamesdeorajan-sys/fiji-platform`, identify:
1. project/service name,
2. application root/build command,
3. production branch,
4. preview branch rules,
5. deploy command/output directory,
6. whether branch pushes auto-deploy,
7. whether path filters exist,
8. which custom domains are attached,
9. whether a non-production branch can update a production custom domain.

At minimum inspect:
- `vakaviti-marketplace-stage1`
- `vakaviti-lagi-public`
- `nadi-guest-widget-preview`
- the Worker serving `api.nadiairporttransfers.com` / `nadi-dispatch-api`

## Required remediation
Prefer one or more of:
- project-specific root directory/path filtering,
- explicit production branch pinning,
- preview-only builds for non-production branches,
- manual/direct upload for sensitive production projects,
- separate repository/application deployment boundaries where path filtering is not reliable.

## Release gate
Attribution implementation may resume after the fanout audit proves that working on `ceo/revenue-attribution-preview` cannot change unrelated production custom domains/resources. This is a deployment-control issue, not a product-code issue.
