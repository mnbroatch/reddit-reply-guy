const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

let env
async function getEnv () {
  if (env) return env
  if (process.env.REDDIT_USER) { // from .env file
    env = {...process.env}
  } else {
    const ssmClient = new SSMClient({ region: "us-east-1" });

    const paramIds = [
      'CLIENT_ID',
      'CLIENT_SECRET',
      'REDDIT_USER',
      'REDDIT_PASS',
      'USER_AGENT',
      'INITIAL_POST_LIMIT',
      'AUTHOR_POST_LIMIT',
      'MIN_PLAGIARIST_CASES_FOR_COMMENT',
      'MIN_PLAGIARIST_CASES_FOR_REPORT',
      'MAX_COMMENT_AGE',
      'MIN_COMMENT_LENGTH',
      'MAX_REMAINDER_AUTHORS',
      'SIMILARITY_THRESHOLD',
      'SIMILARITY_THRESHOLD_LOOSE',
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
