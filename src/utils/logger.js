let chalk;
try {
  chalk = require("chalk");
} catch (_error) {
  chalk = {
    blue: (value) => value,
    yellow: (value) => value,
    red: (value) => value
  };
}

class Logger {
  info(message) {
    console.log(chalk.blue("[info]"), message);
  }

  warn(message) {
    console.warn(chalk.yellow("[warn]"), message);
  }

  error(message) {
    console.error(chalk.red("[error]"), message);
  }
}

module.exports = new Logger();
