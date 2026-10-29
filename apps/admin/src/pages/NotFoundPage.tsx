import { Link } from 'react-router';
import { useI18n } from '../i18n';
import { paths } from '../routes';
import { Icon } from '../components/ui/Icon';

export function NotFoundPage() {
  const { m } = useI18n();
  return (
    <div className="empty">
      <Icon name="search" />
      <h1>{m.notFound.title}</h1>
      <p>{m.notFound.text}</p>
      <Link className="btn btn-primary" to={paths.home}>{m.admin.nav.home}</Link>
    </div>
  );
}
