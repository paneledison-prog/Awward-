/**
 * Open CORS for the endpoints a browser calls cross-origin.
 *
 * The harvest script runs on whatever site the person is looking at, and the
 * extension's service worker has its own origin — both post here. These
 * endpoints read no credentials, and what they return is what that browser's
 * own user is about to be shown.
 */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
