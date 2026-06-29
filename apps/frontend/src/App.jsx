import { Authenticator } from '@aws-amplify/ui-react';
import PortfolioDashboard from './components/PortfolioDashboard';

function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <PortfolioDashboard signOut={signOut} user={user} />
      )}
    </Authenticator>
  );
}

export default App;
