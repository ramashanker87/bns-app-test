# BNS reporting test

An isolated AWS learning stack for authenticated progress reporting. WhatsApp sends are disabled by default and require configured credentials, an approved Flow template, and explicit campaign activation. The dashboard and public demo form are separate from live campaigns.

Deployed test URL: **https://d14nffr8zhz5p0.cloudfront.net**. API: `https://lcs8vj8w82.execute-api.us-west-1.amazonaws.com`. Stack: `JsoWhatsAppReportingTest` in account `223885744552`, region `us-west-1`.

## Deploy

Use AWS profile `jso` and confirm `aws sts get-caller-identity --profile jso` and `aws configure get region --profile jso`. This project targets account `223885744552`, region `us-west-1`. Run `npm install`, `npm install --prefix backend`, `npm test`, `npm run build`, `npx cdk synth --profile jso`, then `npx cdk deploy JsoWhatsAppReportingTest --profile jso --require-approval never --outputs-file cdk-outputs.json`. If CDK reports a missing bootstrap, run `npx cdk bootstrap aws://223885744552/us-west-1 --profile jso` and retry.

Copy the stack outputs into a local `.env.production` as `VITE_API_URL=...`, `VITE_POOL_ID=...`, and `VITE_CLIENT_ID=...`, then build and upload `dist/` to the `SiteBucket` output with `aws s3 sync dist/ s3://BUCKET --profile jso`. Run `python3 scripts/create-admin.py` to create a dashboard administrator. It prompts for a permanent password without printing or saving it. Never commit the bootstrap password.

The CloudFront URL, API URL, pool and client IDs are stack outputs. The site bucket is private behind CloudFront OAC. Cognito protects `/api/*`; public routes are limited to signed Twilio callbacks and expiring token forms. DynamoDB uses on-demand billing and point-in-time recovery. S3 attachments are private and versioned. The default Twilio secret is empty. Set it only with AWS Secrets Manager. Authorized users can request a five-minute attachment download URL through `GET /api/uploads?key=...`; keys are scoped to their Cognito subject.

The live AWS smoke test is `python3 scripts/smoke-live.py`. It creates a temporary administrator, authenticates, records one labeled demo report, uploads a sample PDF header, checks dashboard totals and private bucket access, and deletes the administrator. It leaves demo records and the small test file in the retained resources. No live WhatsApp messages were sent.

`python3 scripts/smoke-geo.py` creates temporary demo records, checks Bihar district data, number lookup, individual/block/district/panchayat/all previews, Flow JSON export, and a draft campaign, then removes the records. It never activates a campaign or sends a message.

## Local development

Run `npx vite` after configuring `VITE_API_URL`, `VITE_POOL_ID`, and `VITE_CLIENT_ID` in a local `.env`. `npm test` runs unit tests. `npm run build` type checks and bundles the frontend. Demo requests are labeled and are available only through an authenticated API call.

## WhatsApp setup

The sample static Flow is [`flow/progress.json`](flow/progress.json). Publish it in WhatsApp Manager for the connected WABA. Set `META_FLOW_ID`, `TWILIO_API_KEY`, and `TWILIO_API_SECRET` only in a local shell, then run `node scripts/create-content.mjs`. Submit the resulting Content SID for WhatsApp approval. Configure the Twilio sender's incoming-message and status callbacks to `API_URL/webhooks/twilio` using POST. Store the account SID, auth token, and sender in the stack's Secrets Manager secret; connect each form's approved Content SID in the Campaigns page. Twilio's `whatsapp/flows` Content type requires a registered sender and WABA; an approved template is required outside a messaging window. This sample is a static Flow, so no data-exchange endpoint is needed. The sample intentionally omits native media pickers because retrieval/decryption is not implemented. The public form is an alternative, clearly separate from native Flows.

Live sending stays disabled until a campaign administrator explicitly activates a draft with a verified, approved Flow template. Recurring weekly/monthly scheduling and reminders are not implemented yet.

## Bihar recipients and custom reporting forms

The Participants page supports **Add one participant** and **Import participants from CSV**. Both store Name, MobileNumber, District, Block, Panchayat, Village, and Ward Number. The columns in [`examples/bihar-participants-template.csv`](examples/bihar-participants-template.csv) also include optional reporting frequency, consent and opt-out fields. A 10-digit Indian mobile is normalized to `+91`; E.164 input is also accepted. The normalized mobile number is the WhatsApp destination. District must be one of Bihar's [38 official districts](https://bvm.bihar.gov.in/district/); block, panchayat, village and ward number are stored from the supplied record. CSV import uses batches of 25. Consent defaults to false, and importing a record cannot clear an existing opt-out. The audience selector supports an individual, a panchayat, a block, a district, or all imported participants. Its preview counts matched records and opted-in, non-opted-out recipients before any campaign is activated. No participant data is imported by default.

The Campaigns page lets an administrator create a form draft with text, number, long-text, and date questions, download the corresponding native WhatsApp Flow JSON, and choose the audience for a campaign draft. Publish the JSON in Meta WhatsApp Manager, create a `whatsapp/flows` Content Template with `flow_token: "{{1}}"`, submit it for approval, then connect its approved Twilio Content SID to the form. The connect action checks the Twilio Content API for the `whatsapp/flows` type and `approved` WhatsApp status. To change a published form, create another draft and approved template; in-place editing is not implemented. A saved draft does not send messages.

Real sending requires Twilio account SID, auth token, and registered sender in the stack's Secrets Manager secret, plus an approved Content SID connected to the selected form. The administrator must preview the audience and explicitly confirm `SEND LIVE` when activating a campaign. A queue fans out individual jobs, creates expected-report records and unique request tokens, and a worker capped at two concurrent SQS invocations rechecks consent, opt-out and completion before dispatching each message. It is capped at approximately two messages per second by default; verify actual Twilio/Meta sender limits before raising throughput. Pause and cancel prevent later queued jobs from sending. Incoming STOP-style replies mark imported participants opted out. Delivery statuses and Flow submissions are stored through the signed webhook path. **No live WhatsApp send has been verified in this environment because Twilio credentials and a test recipient are unavailable.**

## Data model and limits

The DynamoDB table uses `pk` and `sk` plus a `byType` GSI (`gpk`, `gsk`). Participants, campaigns, expected reports, requests, submissions and incoming events use distinct key prefixes. List endpoints page by GSI with an opaque cursor. Expected records provide a basis for missing and late counts. Demo reports have `demo: true` on their expected record. Current totals are based on a limited page of expected records, so they are **not suitable for 10,000 participants** yet; maintained period summaries are required. Corrections and accepted-submission audit handling are also pending.

This deployment is a learning test, not a production-ready reporting service. Remaining work includes recurring scheduling and reminders, end-to-end native Flow testing, media picker retrieval, correction audit workflow, maintained summary records, full analytics, integration alarms, and a scale test. Keep live sending off until the account configuration and one explicitly supplied test recipient have been verified.

## Cost for 10,000 weekly participants

**Planning scenario, not a load-test result or a bill for this deployed test stack.** The current implementation has individual queued dispatch but lacks recurring scheduling, reminders and maintained 10,000-participant dashboard summaries. These figures describe the intended completed architecture. Assume 10,000 opted-in participants, one report request and one accepted report per week, 4.33 weeks per month (**43,300 requests and 43,300 reports/month**), one reminder for 25% of expected reports, 100 dashboard administrators, 300,000 API calls, 500,000 short Lambda invocations, 250,000 DynamoDB writes, 500,000 reads, and one-year attachment retention. The estimates exclude Twilio/Meta messaging and template fees, taxes, free-tier discounts, and unrelated account usage.

| AWS component | Light attachment case | Heavy attachment case |
| --- | ---: | ---: |
| S3 attachments | 20% of reports have one 2 MB file: **17 GB added/month**, about **208 GB after 12 months**; roughly **$5–7/month** at steady state | Every report has one 5 MB file: **217 GB added/month**, about **2.6 TB after 12 months**; roughly **$65–80/month** at steady state |
| DynamoDB on-demand and point-in-time recovery | **$2–6/month** for the stated requests and a small structured-data table | **$2–8/month**, allowing larger metadata and indexes |
| HTTP API, Lambda, SQS, Scheduler, Secrets Manager, CloudWatch, CloudFront and frontend S3 | **$5–17/month** with short functions, low log volume and under 20 GB of dashboard/attachment egress | **$10–42/month** with more download traffic and logs |
| **Planning total at 12-month storage steady state** | **About $12–30/month** | **About $80–130/month** |

Storage builds gradually during the first year; these totals use the **month-12 footprint**. More attachment versions, longer retention, large downloads, retries or verbose logs raise cost. A weekly workload without attachments is much cheaper. The 25% reminder assumption means about 10,800 reminder attempts/month; messaging fees are excluded. Use the [AWS Pricing Calculator](https://calculator.aws/) with the actual `us-west-1` rates before enabling production traffic. The pricing model follows [S3](https://aws.amazon.com/s3/pricing/), [DynamoDB](https://aws.amazon.com/dynamodb/pricing/), [HTTP API](https://aws.amazon.com/api-gateway/pricing/), [Lambda](https://aws.amazon.com/lambda/pricing/), [EventBridge Scheduler](https://aws.amazon.com/eventbridge/pricing/), and [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/). Scheduler's published free tier covers 14 million invocations/month, well above this scenario; the account's shared free-tier usage still matters.

## Retention and cleanup at weekly scale

1. Pause or cancel active campaigns, then allow queued jobs and webhooks to finish. Record the final reporting cutoff and the retention decision.
2. Export the DynamoDB table and attachment bucket if reports must be retained. Include attachment object versions and the mapping from submissions to files. Confirm the export is readable before deleting data. DynamoDB point-in-time recovery covers a rolling period of up to 35 days; it is not a long-term archive.
3. Run `npx cdk destroy JsoWhatsAppReportingTest --profile jso` only when the site and API should go offline. This removes the application stack's non-retained resources, but the DynamoDB table and both S3 buckets use `RETAIN` and can continue billing after stack deletion.
4. After the retention period and with the correct resource names confirmed from `cdk-outputs.json` and CloudFormation, delete the retained table and buckets deliberately. For the **versioned attachment bucket**, delete every object version and delete marker before deleting the bucket; `aws s3 rm --recursive` alone does not erase prior versions. Review any separate exports and backups as well. DynamoDB creates a 35-day system backup when a table with PITR is deleted.
5. Check AWS Cost Explorer or billing after cleanup for retained storage, backups and logs. Leave the shared `CDKToolkit` bootstrap stack alone because other CDK applications may use it.

Do not run cleanup commands against unrelated JSO resources. The exact deployed bucket names are in `cdk-outputs.json` and the stack outputs; verify the `Application=jso-whatsapp-reporting` tag before removal.
