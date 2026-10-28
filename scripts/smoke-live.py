"""Isolated AWS smoke test. Creates and removes a temporary Cognito user."""
import json, secrets, uuid, urllib.request, urllib.error
import boto3

out=json.load(open('cdk-outputs.json'))['JsoWhatsAppReportingTest']
aws=boto3.Session(profile_name='jso',region_name='us-west-1')
c=aws.client('cognito-idp');s3=aws.client('s3')
username=f'fieldnote-smoke-{uuid.uuid4().hex[:10]}@example.invalid'
password='T9!'+secrets.token_urlsafe(24)
pool=out['UserPoolId'];client=out['ClientId'];api=out['ApiUrl']
def call(path,method='GET',data=None,jwt=None):
    b=json.dumps(data).encode() if data is not None else None
    req=urllib.request.Request(api+path,b,method=method,headers={'content-type':'application/json',**({'authorization':'Bearer '+jwt} if jwt else {})})
    with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)
try:
    c.admin_create_user(UserPoolId=pool,Username=username,UserAttributes=[{'Name':'email','Value':username},{'Name':'email_verified','Value':'true'}],MessageAction='SUPPRESS')
    c.admin_set_user_password(UserPoolId=pool,Username=username,Password=password,Permanent=True)
    auth=c.initiate_auth(ClientId=client,AuthFlow='USER_PASSWORD_AUTH',AuthParameters={'USERNAME':username,'PASSWORD':password})
    jwt=auth['AuthenticationResult']['IdToken'];print('Cognito login: PASS')
    try:call('/api/overview')
    except urllib.error.HTTPError as e:assert e.code==401;print('Unauthenticated API: PASS')
    demo=call('/api/demo','POST',{},jwt);token=demo['token']
    report={'progress':7,'unit':'milestones','comments':'AWS smoke test'}
    call('/forms/'+token,'POST',report)
    duplicate=call('/forms/'+token,'POST',report)
    assert duplicate.get('duplicate') is True;print('Duplicate form delivery: PASS')
    campaign=call('/forms/'+token)['campaignId']
    resources=aws.client('cloudformation').list_stack_resources(StackName='JsoWhatsAppReportingTest')['StackResourceSummaries']
    table=next(r['PhysicalResourceId'] for r in resources if r['ResourceType']=='AWS::DynamoDB::Table')
    records=aws.client('dynamodb').query(TableName=table,KeyConditionExpression='pk = :p',ExpressionAttributeValues={':p':{'S':'SUBMISSION#'+campaign}})
    assert len(records['Items'])==1;print('Submission persisted in DynamoDB once: PASS')
    overview=call('/api/overview',jwt=jwt)
    assert overview['completed']>=1;print('Demo report and dashboard metric: PASS')
    upload=call('/api/uploads','POST',{'type':'application/pdf','size':8},jwt)
    req=urllib.request.Request(upload['url'],b'%PDF-1.0',method='PUT',headers={'content-type':'application/pdf'})
    with urllib.request.urlopen(req,timeout=30) as r:assert r.status==200
    s3.head_object(Bucket=out['FileBucket'],Key=upload['key']);print('Private attachment stored: PASS')
    download=call('/api/uploads?key='+upload['key'],jwt=jwt)
    with urllib.request.urlopen(download['url'],timeout=20) as r:assert r.read()==b'%PDF-1.0'
    print('Authorized attachment download: PASS')
    try:urllib.request.urlopen('https://'+out['FileBucket']+'.s3.us-west-1.amazonaws.com/'+upload['key'],timeout=20);raise AssertionError('Public read succeeded')
    except urllib.error.HTTPError as e:assert e.code==403;print('Public attachment read denied: PASS')
finally:
    try:c.admin_delete_user(UserPoolId=pool,Username=username)
    except c.exceptions.UserNotFoundException:pass
