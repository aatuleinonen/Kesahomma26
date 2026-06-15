import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Amplify } from 'aws-amplify'
import '@aws-amplify/ui-react/styles.css'
import './index.css'
import App from './App.jsx'

const userPoolId = import.meta.env.VITE_USER_POOL_ID;
const userPoolClientId = import.meta.env.VITE_USER_POOL_CLIENT_ID;

if (userPoolId && userPoolClientId) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        region: userPoolId.split('_')[0],
      },
    },
  });
} else {
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error("Missing #root element");

  createRoot(rootEl).render(
    <StrictMode>
      <div style={{ padding: '2rem' }}>
        Missing required environment variables: VITE_USER_POOL_ID and/or VITE_USER_POOL_CLIENT_ID.
      </div>
    </StrictMode>,
  );

  throw new Error('Amplify Cognito configuration is missing required env vars');
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error("Missing #root element");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
