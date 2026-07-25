import { Authenticator } from '@aws-amplify/ui-react';
import PortfolioDashboard from './components/PortfolioDashboard';

function App() {
  return (
    <Authenticator hideSignUp>
      {({ signOut, user }) => (
        <PortfolioDashboard signOut={signOut} user={user} />
      )}
    </Authenticator>
  );
}

export default App;
