# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lambdalet.AI is an AI-powered bookmarking and read-it-later service that uses a JavaScript bookmarklet to send web page content to AWS Lambda functions. The system processes HTML pages through AWS Bedrock's Claude 3.7 Sonnet model to extract main content and stores it in a Notion database.

## Development Commands

- `pnpm install` - Install dependencies
- `pnpm build` - Compile TypeScript to JavaScript
- `pnpm watch` - Watch for changes and recompile
- `pnpm cdk deploy` - Deploy the infrastructure to AWS
- `pnpm tsx bin/lambdalet.ts` - Run the CDK app locally

## Code Quality

- **Linting**: Uses Biome (`@biomejs/biome`) for code formatting and linting
- **TypeScript**: Strict mode enabled with ES2022 target
- **Code Style**: Single quotes, semicolons, trailing commas enforced via Biome

## Architecture

The application follows a serverless architecture with three main Lambda functions:

### 1. API Authorizer (`src/functions/api-authorizer.ts`)
- Validates API keys from query string parameters
- Returns IAM policy for API Gateway authorization
- Required because bookmarklet needs query string API key support

### 2. Queue Request (`src/functions/queue-request.ts`)
- Receives POST requests from API Gateway
- Uploads large HTML payloads to S3 (bypasses 256KB SQS limit)
- Sends message to SQS FIFO queue for deduplication
- Supports multiple response types: `fetch`, `form-blank`, `form-self`

### 3. Process Request (`src/functions/process-request.ts`)
- Triggered by SQS messages (batch size: 1)
- Downloads payload from S3
- Converts HTML to Markdown
- Extracts main content via Bedrock Claude 3.7 Sonnet (document mode only)
- Creates/updates Notion pages with extracted content

## Key Components

### AWS Infrastructure (`lib/lambdalet-stack.ts`)
- API Gateway with custom authorizer
- Three Lambda functions with appropriate IAM permissions
- S3 bucket for payload storage (7-day lifecycle)
- SQS FIFO queue for deduplication
- CloudWatch Logs with predefined queries

### Schema Validation (`src/schema.ts`)
- Zod schemas for request validation
- Environment variable validation
- Type-safe data structures
- Supports invoke types: `fetch`, `form-blank`, `form-self`, `window-open`

### Libraries (`src/libs/`)
- `bedrock.ts` - AWS Bedrock integration for content extraction
- `notion.ts` - Notion API integration
- `s3.ts` - S3 operations
- `sqs.ts` - SQS messaging
- `markdown.ts` - HTML to Markdown conversion

## Environment Variables

Required environment variables (configured in `.env` file):
- `NOTION_TOKEN` - Notion integration secret
- `NOTION_DATABASE_ID` - Target Notion database ID

## CDK Configuration

- Uses `cdk.json` for CDK app configuration
- Entry point: `bin/lambdalet.ts`
- Stack: `LambdaletStack` in `lib/lambdalet-stack.ts`
- Outputs API URL and API key after deployment

## Testing

No test framework is currently configured. Tests would need to be added if required.

## Deployment

1. Set up `.env` file with Notion credentials
2. Run `pnpm cdk deploy` to deploy infrastructure
3. Use output API URL and key to create bookmarklet
4. Bookmarklet code templates in `bookmarklets/` directory

## Key Features

- **Deduplication**: Uses URL hashing for S3 keys and SQS deduplication
- **Content Extraction**: Claude 3.7 Sonnet extracts main content from full pages
- **Selection Mode**: Saves user-selected text without AI processing
- **Advanced CSP Handling**: Bookmarklet proactively checks CSP headers and intelligently chooses the best submission method
- **Triple Fallback Strategy**: 
  1. Fetch API (preferred)
  2. Form submission (if fetch blocked by CSP)
  3. Window.open with query parameters (if both blocked)
- **Rate Limiting**: API Gateway usage plans prevent abuse
- **Monitoring**: CloudWatch Logs with custom queries for debugging

## Important Notes

- Lambda functions use Node.js 22.x runtime
- ESM modules throughout (type: "module" in package.json)
- AWS Lambda Powertools for logging and parsing
- Middy middleware for Lambda function composition
- Process request function has 15-minute timeout for large pages
- S3 objects expire after 7 days to manage storage costs