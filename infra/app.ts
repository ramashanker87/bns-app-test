import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import * as fs from 'fs';

class ReportingStack extends cdk.Stack {
 constructor(scope:Construct,id:string,props:cdk.StackProps){super(scope,id,props);
  cdk.Tags.of(this).add('Application','jso-whatsapp-reporting'); cdk.Tags.of(this).add('Environment','learning');
  const site=new s3.Bucket(this,'Site',{blockPublicAccess:s3.BlockPublicAccess.BLOCK_ALL,enforceSSL:true,removalPolicy:cdk.RemovalPolicy.RETAIN});
  const files=new s3.Bucket(this,'Attachments',{blockPublicAccess:s3.BlockPublicAccess.BLOCK_ALL,enforceSSL:true,versioned:true,removalPolicy:cdk.RemovalPolicy.RETAIN});
  const table=new dynamodb.Table(this,'Records',{partitionKey:{name:'pk',type:dynamodb.AttributeType.STRING},sortKey:{name:'sk',type:dynamodb.AttributeType.STRING},billingMode:dynamodb.BillingMode.PAY_PER_REQUEST,pointInTimeRecoverySpecification:{pointInTimeRecoveryEnabled:true},removalPolicy:cdk.RemovalPolicy.RETAIN});
  table.addGlobalSecondaryIndex({indexName:'byType',partitionKey:{name:'gpk',type:dynamodb.AttributeType.STRING},sortKey:{name:'gsk',type:dynamodb.AttributeType.STRING}});
  const pool=new cognito.UserPool(this,'Admins',{selfSignUpEnabled:false,signInAliases:{email:true},passwordPolicy:{minLength:12,requireDigits:true,requireLowercase:true,requireUppercase:true,requireSymbols:true},accountRecovery:cognito.AccountRecovery.EMAIL_ONLY});
  const client=pool.addClient('Dashboard',{authFlows:{userPassword:true,userSrp:true},generateSecret:false});
  const secret=new secrets.Secret(this,'TwilioConfig',{secretObjectValue:{accountSid:cdk.SecretValue.unsafePlainText(''),authToken:cdk.SecretValue.unsafePlainText(''),sender:cdk.SecretValue.unsafePlainText(''),contentSid:cdk.SecretValue.unsafePlainText('')}});
  const dlq=new sqs.Queue(this,'WebhookDLQ',{retentionPeriod:cdk.Duration.days(14)});
  const queue=new sqs.Queue(this,'WebhookQueue',{deadLetterQueue:{queue:dlq,maxReceiveCount:5},visibilityTimeout:cdk.Duration.seconds(90)});
  const sendDlq=new sqs.Queue(this,'SendDLQ',{retentionPeriod:cdk.Duration.days(14)});
  const sendQueue=new sqs.Queue(this,'SendQueue',{deadLetterQueue:{queue:sendDlq,maxReceiveCount:4},visibilityTimeout:cdk.Duration.seconds(120)});
  const common={TABLE:table.tableName,FILES:files.bucketName,QUEUE:queue.queueUrl,SEND_QUEUE:sendQueue.queueUrl,SECRET:secret.secretArn};
  const apiFn=new lambda.Function(this,'ApiHandler',{runtime:lambda.Runtime.NODEJS_22_X,handler:'api.handler',code:lambda.Code.fromAsset('backend'),environment:common,timeout:cdk.Duration.seconds(29),logRetention:logs.RetentionDays.ONE_WEEK});
  const worker=new lambda.Function(this,'WebhookWorker',{runtime:lambda.Runtime.NODEJS_22_X,handler:'worker.handler',code:lambda.Code.fromAsset('backend'),environment:common,timeout:cdk.Duration.seconds(60),logRetention:logs.RetentionDays.ONE_WEEK});
  const sender=new lambda.Function(this,'SendWorker',{runtime:lambda.Runtime.NODEJS_22_X,handler:'send.handler',code:lambda.Code.fromAsset('backend'),environment:common,timeout:cdk.Duration.seconds(90),logRetention:logs.RetentionDays.ONE_WEEK});
  worker.addEventSource(new sources.SqsEventSource(queue,{batchSize:1}));sender.addEventSource(new sources.SqsEventSource(sendQueue,{batchSize:1,maxConcurrency:2}));table.grantReadWriteData(apiFn);table.grantReadWriteData(worker);table.grantReadWriteData(sender);files.grantReadWrite(apiFn);queue.grantSendMessages(apiFn);sendQueue.grantSendMessages(apiFn);sendQueue.grantSendMessages(sender);secret.grantRead(apiFn);secret.grantRead(worker);secret.grantRead(sender);
  const api=new apigwv2.HttpApi(this,'HttpApi',{corsPreflight:{allowOrigins:['*'],allowHeaders:['authorization','content-type'],allowMethods:[apigwv2.CorsHttpMethod.ANY]}});
  const jwt=new authorizers.HttpJwtAuthorizer('CognitoJwt',`https://cognito-idp.${this.region}.amazonaws.com/${pool.userPoolId}`,{jwtAudience:[client.userPoolClientId]});
  const integration=new integrations.HttpLambdaIntegration('ApiIntegration',apiFn);
  for(const path of ['/api/overview','/api/participants','/api/campaigns','/api/submissions','/api/settings','/api/uploads','/api/demo']) for(const method of [apigwv2.HttpMethod.GET,apigwv2.HttpMethod.POST]) api.addRoutes({path,methods:[method],integration,authorizer:jwt});
  for(const path of ['/api/geography','/api/recipients','/api/recipients/import','/api/target-preview','/api/form-definitions','/api/form-definitions/{id}/flow','/api/form-definitions/{id}/connect','/api/campaign-builder','/api/campaign-builder/{id}/activate','/api/campaign-builder/{id}/pause','/api/campaign-builder/{id}/cancel']) for(const method of [apigwv2.HttpMethod.GET,apigwv2.HttpMethod.POST]) api.addRoutes({path,methods:[method],integration,authorizer:jwt});
  for(const path of ['/webhooks/twilio','/forms/{token}']) api.addRoutes({path,methods:[apigwv2.HttpMethod.GET,apigwv2.HttpMethod.POST],integration});
  const distribution=new cloudfront.Distribution(this,'Distribution',{defaultBehavior:{origin:origins.S3BucketOrigin.withOriginAccessControl(site),viewerProtocolPolicy:cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS},defaultRootObject:'index.html',errorResponses:[{httpStatus:403,responseHttpStatus:200,responsePagePath:'/index.html'}]});
  new cdk.CfnOutput(this,'CloudFrontUrl',{value:`https://${distribution.distributionDomainName}`});new cdk.CfnOutput(this,'ApiUrl',{value:api.apiEndpoint});new cdk.CfnOutput(this,'UserPoolId',{value:pool.userPoolId});new cdk.CfnOutput(this,'ClientId',{value:client.userPoolClientId});new cdk.CfnOutput(this,'SiteBucket',{value:site.bucketName});new cdk.CfnOutput(this,'FileBucket',{value:files.bucketName});
 }
}
const app=new cdk.App();new ReportingStack(app,'JsoWhatsAppReportingTest',{env:{account:process.env.CDK_DEFAULT_ACCOUNT,region:process.env.CDK_DEFAULT_REGION||'us-west-1'}});
