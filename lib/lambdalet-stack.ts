import * as cdk from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import {
	ApiKeySourceType,
	AuthorizationType,
	Cors,
	LambdaIntegration,
	Period,
	RequestAuthorizer,
	RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import type { Construct } from 'constructs';
import 'dotenv/config';
import {
	BEDROCK_FOUNDATION_MODEL_ID,
	BEDROCK_INFERENCE_PROFILE_ID,
} from '../src/libs/bedrock.js';
import { NotionEnvSchema } from '../src/schema.js';

export class LambdaletStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		/**
		 * Parse the environment variables loaded from the .env file via dotenv.
		 * Throws if variables are missing.
		 */
		const notionEnv = NotionEnvSchema.parse(process.env);

		/**
		 * We manage the timeout within the lambda function, so we can set the max here.
		 */
		const timeout = Duration.minutes(15);

		/**
		 * S3 bucket to store the page content.
		 */
		const bucket = new s3.Bucket(this, 'lambdalet-bucket', {
			lifecycleRules: [
				{
					expiration: Duration.days(7),
				},
			],
		});

		/**
		 * SQS queue to deduplicate requests.
		 */
		const queue = new sqs.Queue(this, 'lambdalet-queue', {
			queueName: 'lambdalet-queue.fifo',
			fifo: true,
			visibilityTimeout: timeout,
		});

		/**
		 * Lambda function that is invoked by API Gateway.
		 */
		const processRequestLambda = new NodejsFunction(
			this,
			'lambdalet-process-request',
			{
				functionName: 'lambdalet-process-request',
				entry: 'src/functions/process-request.ts',
				handler: 'handler',
				runtime: Runtime.NODEJS_22_X,
				timeout,
				memorySize: 1024,
				environment: {
					NODE_OPTIONS: '--enable-source-maps --stack-trace-limit=1000',
					...notionEnv,
				},
				bundling: {
					format: OutputFormat.ESM,
					nodeModules: ['@smithy/eventstream-codec', '@tryfabric/martian'],
				},
				layers: [],
			},
		);

		/**
		 * Allow the Lambda function to invoke the Bedrock model.
		 */
		processRequestLambda.addToRolePolicy(
			new iam.PolicyStatement({
				actions: ['bedrock:InvokeModel'],
				resources: [
					`arn:aws:bedrock:*:*:foundation-model/${BEDROCK_FOUNDATION_MODEL_ID}`,
					`arn:aws:bedrock:*:*:inference-profile/${BEDROCK_INFERENCE_PROFILE_ID}`,
				],
			}),
		);

		/**
		 * Trigger the Lambda function with a batch size of 1 to avoid timeouts.
		 */
		processRequestLambda.addEventSource(
			new SqsEventSource(queue, { batchSize: 1 }),
		);

		/**
		 * Lambda function that is invoked by SQS.
		 */
		const queueRequestLambda = new NodejsFunction(
			this,
			'lambdalet-queue-request',
			{
				functionName: 'lambdalet-queue-request',
				entry: 'src/functions/queue-request.ts',
				handler: 'handler',
				runtime: Runtime.NODEJS_22_X,
				timeout: Duration.seconds(30),
				memorySize: 512,
				environment: {
					NODE_OPTIONS: '--enable-source-maps --stack-trace-limit=1000',
					BUCKET_NAME: bucket.bucketName,
					QUEUE_URL: queue.queueUrl,
				},
				bundling: {
					format: OutputFormat.ESM,
				},
			},
		);

		/**
		 * Lambda function that authorizes API requests by extracting API key from query string.
		 */
		const apiAuthorizerLambda = new NodejsFunction(
			this,
			'lambdalet-api-authorizer',
			{
				functionName: 'lambdalet-api-authorizer',
				entry: 'src/functions/api-authorizer.ts',
				handler: 'handler',
				runtime: Runtime.NODEJS_22_X,
				timeout: Duration.seconds(30),
				memorySize: 256,
				environment: {
					NODE_OPTIONS: '--enable-source-maps --stack-trace-limit=1000',
				},
				bundling: {
					format: OutputFormat.ESM,
				},
			},
		);

		bucket.grantRead(processRequestLambda);
		bucket.grantWrite(queueRequestLambda);
		bucket.grantWrite(processRequestLambda);
		queue.grantConsumeMessages(processRequestLambda);
		queue.grantSendMessages(queueRequestLambda);

		/**
		 * API Gateway API invoked by the bookmarklet.
		 */
		const api = new RestApi(this, 'lambdalet-api', {
			apiKeySourceType: ApiKeySourceType.AUTHORIZER,
			defaultCorsPreflightOptions: {
				allowOrigins: Cors.ALL_ORIGINS,
				allowMethods: Cors.ALL_METHODS,
				allowHeaders: ['content-type'],
			},
		});

		/**
		 * Create a request authorizer that uses the API authorizer Lambda function.
		 */
		const authorizer = new RequestAuthorizer(this, 'lambdalet-authorizer', {
			handler: apiAuthorizerLambda,
			authorizerName: 'lambdalet-authorizer',
			identitySources: ['method.request.querystring.apiKey'],
		});

		api.root.addMethod('POST', new LambdaIntegration(queueRequestLambda), {
			authorizer,
			apiKeyRequired: true,
			authorizationType: AuthorizationType.CUSTOM,
		});

		/**
		 * API key and usage plan to set usage limits.
		 */
		const key = api.addApiKey('lambdalet-apikey');
		const plan = api.addUsagePlan('lambdalet-usageplan', {
			quota: {
				limit: 100,
				period: Period.DAY,
			},
			throttle: {
				rateLimit: 10,
			},
		});

		plan.addApiKey(key);
		plan.addApiStage({ api, stage: api.deploymentStage });

		/**
		 * CloudWatch Logs Insights queries to monitor logs.
		 */
		new logs.CfnQueryDefinition(this, 'lambdalet-logs', {
			name: 'lambdalet-logs',
			queryString: `
fields @timestamp, @message, @logStream, @log
| sort @timestamp desc
| limit 10000`,
			logGroupNames: [
				processRequestLambda.logGroup.logGroupName,
				queueRequestLambda.logGroup.logGroupName,
				apiAuthorizerLambda.logGroup.logGroupName,
			],
		});
		new logs.CfnQueryDefinition(this, 'lambdalet-logs-errors', {
			name: 'lambdalet-logs-errors',
			queryString: `
fields @timestamp, @message, @logStream, @log
| filter @message like /(?i)error/ 
| sort @timestamp desc
| limit 10000`,
			logGroupNames: [
				processRequestLambda.logGroup.logGroupName,
				queueRequestLambda.logGroup.logGroupName,
				apiAuthorizerLambda.logGroup.logGroupName,
			],
		});

		/**
		 * Custom resource to retrieve the API key value
		 */
		const apiKeyRetriever = new cr.AwsCustomResource(this, 'ApiKeyRetriever', {
			onUpdate: {
				service: 'APIGateway',
				action: 'getApiKey',
				parameters: {
					apiKey: key.keyId,
					includeValue: true,
				},
				physicalResourceId: cr.PhysicalResourceId.of('ApiKeyRetriever'),
			},
			policy: cr.AwsCustomResourcePolicy.fromStatements([
				new iam.PolicyStatement({
					actions: ['apigateway:GET'],
					resources: [
						`arn:aws:apigateway:${this.region}::/apikeys/${key.keyId}`,
					],
				}),
			]),
		});

		/**
		 * Output the API URL and API key.
		 */
		new cdk.CfnOutput(this, 'ApiUrl', {
			value: api.url,
		});

		new cdk.CfnOutput(this, 'ApiKey', {
			value: apiKeyRetriever.getResponseField('value'),
		});
	}
}
