"""Read/write smoke test for Bihar targeting. Removes its temporary records."""
import json,secrets,uuid,urllib.request,urllib.error,urllib.parse,datetime,boto3
from hashlib import sha256
out=json.load(open('cdk-outputs.json'))['JsoWhatsAppReportingTest'];session=boto3.Session(profile_name='jso',region_name='us-west-1')
c=session.client('cognito-idp');ddb=session.client('dynamodb');cf=session.client('cloudformation')
table=next(x['PhysicalResourceId'] for x in cf.list_stack_resources(StackName='JsoWhatsAppReportingTest')['StackResourceSummaries'] if x['ResourceType']=='AWS::DynamoDB::Table')
username=f'bns-geo-smoke-{uuid.uuid4().hex[:8]}@example.invalid';password='T9!'+secrets.token_urlsafe(24);jwt=None;pid=None;fid=None;cid=None
phone='+999000000000';pid=sha256(phone.encode()).hexdigest()[:32]
def call(path,method='GET',data=None):
    body=json.dumps(data).encode() if data is not None else None
    req=urllib.request.Request(out['ApiUrl']+path,body,method=method,headers={'content-type':'application/json','authorization':'Bearer '+jwt})
    with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)
def delete(pk,sk):ddb.delete_item(TableName=table,Key={'pk':{'S':pk},'sk':{'S':sk}})
try:
    c.admin_create_user(UserPoolId=out['UserPoolId'],Username=username,UserAttributes=[{'Name':'email','Value':username},{'Name':'email_verified','Value':'true'}],MessageAction='SUPPRESS')
    c.admin_set_user_password(UserPoolId=out['UserPoolId'],Username=username,Password=password,Permanent=True)
    jwt=c.initiate_auth(ClientId=out['ClientId'],AuthFlow='USER_PASSWORD_AUTH',AuthParameters={'USERNAME':username,'PASSWORD':password})['AuthenticationResult']['IdToken']
    assert len(call('/api/geography')['districts'])==38;print('Bihar districts: PASS')
    item={'name':'DEMO Bihar smoke test','mobileNumber':phone,'district':'Patna','block':'Phulwari Sharif','panchayat':'Rampur','village':'Test Village','wardNumber':'7','consent':True,'frequency':'weekly'}
    call('/api/recipients/import','POST',{'items':[item]})
    found=call('/api/recipients?phone='+urllib.parse.quote(phone))['items'];assert len(found)==1 and found[0]['id']==pid and found[0]['village']=='Test Village' and found[0]['wardNumber']=='7';print('Number, village and ward import: PASS')
    for target in [{'scope':'individual','participantId':pid},{'scope':'district','district':'Patna'},{'scope':'block','district':'Patna','block':'Phulwari Sharif'},{'scope':'panchayat','district':'Patna','block':'Phulwari Sharif','panchayat':'Rampur'},{'scope':'all'}]:
        assert call('/api/target-preview','POST',{'target':target})['eligible']>=1
    print('Individual, district, block, panchayat and all previews: PASS')
    f=call('/api/form-definitions','POST',{'title':'DEMO smoke form','fields':[{'label':'Progress','type':'number','required':True}]});fid=f['id']
    flow=call(f'/api/form-definitions/{fid}/flow');assert flow['screens'][0]['id']=='REPORT';print('Custom Flow export: PASS')
    due=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=1)).isoformat()
    campaign=call('/api/campaign-builder','POST',{'name':'DEMO smoke campaign','formId':fid,'target':{'scope':'individual','participantId':pid},'dueAt':due,'period':'DEMO','timezone':'Asia/Kolkata'});cid=campaign['id']
    assert campaign['status']=='draft';print('Campaign remains draft; no message sent: PASS')
finally:
    if cid:delete('CAMPAIGN#'+cid,'META')
    if fid:delete('FORM#'+fid,'META')
    delete('PARTICIPANT#'+pid,'META')
    for key in ['GEO#D#patna','GEO#B#patna#phulwari sharif','GEO#P#patna#phulwari sharif#rampur']:delete(key,'PARTICIPANT#'+pid)
    try:c.admin_delete_user(UserPoolId=out['UserPoolId'],Username=username)
    except c.exceptions.UserNotFoundException:pass
