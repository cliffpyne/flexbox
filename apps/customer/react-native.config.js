// apps/customer/react-native.config.js
module.exports = {
  project: {
    android: {
      sourceDir: './android',
      packageName: 'com.customer',
    },
  },
  // ✅ FIX: Point to ROOT node_modules/react-native
  // From apps/customer/ → ../../node_modules/react-native
  reactNativePath: '../../node_modules/react-native',
};