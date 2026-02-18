import { getLoginUrl } from '../api';

export default function ConnectOrgButton() {
  return (
    <a href={getLoginUrl()} className="connect-btn">
      Connect Salesforce Org
    </a>
  );
}
