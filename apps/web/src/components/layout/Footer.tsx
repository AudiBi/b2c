import { config } from '../../config';
import { useI18n } from '../../i18n';
import { LocLink } from '../LocLink';
import { LogoMark } from '../ui/Logo';

export function Footer() {
  const { m } = useI18n();
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <p className="brand" style={{ color: '#fff' }}>
              <LogoMark />
              <span>{config.brandName}</span>
            </p>
            <p>{m.footer.tagline}</p>
          </div>
          <nav aria-label={`${m.footer.explore}`}>
            <h2>{m.footer.explore}</h2>
            <ul>
              <li><LocLink page="services">{m.nav.services}</LocLink></li>
              <li><LocLink page="howItWorks">{m.nav.howItWorks}</LocLink></li>
              <li><LocLink page="calculator">{m.nav.calculator}</LocLink></li>
              <li><LocLink page="tracking">{m.nav.tracking}</LocLink></li>
              <li><LocLink page="locations">{m.nav.locations}</LocLink></li>
            </ul>
          </nav>
          <nav aria-label={`${m.footer.help}`}>
            <h2>{m.footer.help}</h2>
            <ul>
              <li><LocLink page="faq">{m.nav.faq}</LocLink></li>
              <li><LocLink page="contact">{m.nav.contact}</LocLink></li>
              <li><LocLink page="about">{m.nav.about}</LocLink></li>
              <li><LocLink page="register">{m.nav.register}</LocLink></li>
            </ul>
          </nav>
          <nav aria-label={`${m.footer.legal}`}>
            <h2>{m.footer.legal}</h2>
            <ul>
              <li><LocLink page="terms">{m.footer.terms}</LocLink></li>
              <li><LocLink page="privacy">{m.footer.privacy}</LocLink></li>
            </ul>
          </nav>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} {config.brandName}. {m.footer.rights}</span>
        </div>
      </div>
    </footer>
  );
}
