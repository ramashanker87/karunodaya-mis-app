export interface Config {
  region: string;
  operationsTable: string;
  studentsTable: string;
  auditTable: string;
  accessTable: string;
  uploadsBucket: string;
  cognitoPoolId: string;
  cognitoClientId: string;
  dynamoEndpoint?: string;
  mockAuth: boolean;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const mockAuth = env.DEV_MOCK_AUTH === 'true';
  if (production && mockAuth) throw new Error('Development mock authentication is forbidden in production');
  const config: Config = {
    region: env.AWS_REGION || 'us-east-1',
    operationsTable: env.OPERATIONS_TABLE || 'karunodaya-local-operations',
    studentsTable: env.STUDENTS_TABLE || 'karunodaya-local-students',
    auditTable: env.AUDIT_TABLE || 'karunodaya-local-audit',
    accessTable: env.ACCESS_TABLE || 'karunodaya-local-access',
    uploadsBucket: env.UPLOADS_BUCKET || '',
    cognitoPoolId: env.COGNITO_USER_POOL_ID || '',
    cognitoClientId: env.COGNITO_CLIENT_ID || '',
    dynamoEndpoint: env.DYNAMODB_ENDPOINT,
    mockAuth,
    port: Number(env.PORT || 3000),
  };
  if (production && (!config.cognitoPoolId || !config.cognitoClientId || !config.uploadsBucket)) {
    throw new Error('Production Cognito and uploads configuration is required');
  }
  return config;
}
