module.exports = {
    resolve: {
      fallback: {
        "process": require.resolve("process/browser"),
        "buffer": require.resolve("buffer/"),
      },
    },
  };