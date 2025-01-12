const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

let env
async function getEnv () {
  if (env) return env
  if (process.env.IS_LOCAL) {
    env = {...process.env}
  } else {
    const ssmClient = new SSMClient({ region: 'us-east-1' });

    const paramIds = [
      'CLIENT_ID',
      'CLIENT_SECRET',
      'REDDIT_USER',
      'REDDIT_PASS',
      'USER_AGENT',
    ]

    env = (await Promise.all(paramIds.map(id => {
      const params = { Name: id };

      const command = new GetParameterCommand(params);

      return ssmClient.send(command)
    })))
      .reduce((acc, val, i) => ({
        ...acc,
        [paramIds[i]]: val.Parameter.Value
      }), {})
  }
  return env
}

module.exports = getEnv
