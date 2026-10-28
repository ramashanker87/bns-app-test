"""Create dashboard admin without printing or storing its password."""
import getpass,json,sys,boto3
o=json.load(open('cdk-outputs.json'))['JsoWhatsAppReportingTest']
email=input('Administrator email: ').strip()
password=getpass.getpass('Permanent password (12+ characters, mixed case, number, symbol): ')
c=boto3.Session(profile_name='jso',region_name='us-west-1').client('cognito-idp')
c.admin_create_user(UserPoolId=o['UserPoolId'],Username=email,UserAttributes=[{'Name':'email','Value':email},{'Name':'email_verified','Value':'true'}],MessageAction='SUPPRESS')
c.admin_set_user_password(UserPoolId=o['UserPoolId'],Username=email,Password=password,Permanent=True)
print('Administrator created. Sign in at '+o['CloudFrontUrl'])
