import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export type WaitlistReplacementCodeEmailProps = {
  code: string;
  loginUrl: string;
  unsubscribeUrl: string;
};

const LOGO_URL = "https://mogplex.com/email/mogplex-logo-black.png";
const SITE_URL = "https://mogplex.com";
const PRIVACY_URL = "https://mogplex.com/privacy";

export function WaitlistReplacementCodeEmail({
  code = "r-1234567890abcdef",
  loginUrl = "https://mogplex.com/login",
  unsubscribeUrl = "https://mogplex.com/unsubscribe?email=preview%40mogplex.com&t=preview",
}: WaitlistReplacementCodeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your new Mogplex access code (single use, 24 hours)</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={logoSection}>
            <Img src={LOGO_URL} alt="Mogplex" width="165" height="36" style={logo} />
          </Section>

          <Text style={heading}>Your new Mogplex access code</Text>

          <Text style={paragraph}>
            Paste this on{" "}
            <Link href={loginUrl} style={link}>
              {loginUrl}
            </Link>{" "}
            to sign in. Single use, expires in 24 hours.
          </Text>

          <Section style={codeWrap}>
            <Text style={codeText}>{code}</Text>
          </Section>

          <Text style={footnote}>
            If you didn&apos;t request this, you can ignore it — the code only
            works for the account it was issued to.
          </Text>

          <Hr style={divider} />

          <Section>
            <Text style={legal}>
              You&apos;re receiving this because you requested a new Mogplex
              access code.
            </Text>
            <Text style={legal}>
              Mogplex ·{" "}
              <Link href={SITE_URL} style={legalLink}>
                mogplex.com
              </Link>{" "}
              ·{" "}
              <Link href={PRIVACY_URL} style={legalLink}>
                Privacy
              </Link>{" "}
              ·{" "}
              <Link href={unsubscribeUrl} style={legalLink}>
                Unsubscribe
              </Link>
            </Text>
            <Text style={legal}>
              Unsubscribing stops every Mogplex email, including new sign-in
              codes — you won&apos;t be able to use email-based sign-in for
              this address afterward.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default WaitlistReplacementCodeEmail;

const body: React.CSSProperties = {
  backgroundColor: "#f4f1eb",
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  margin: 0,
  padding: 0,
};

const container: React.CSSProperties = {
  maxWidth: 560,
  margin: "0 auto",
  padding: "40px 24px",
};

const logoSection: React.CSSProperties = {
  marginBottom: 32,
};

const logo: React.CSSProperties = {
  display: "block",
};

const heading: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  color: "#0a0a0a",
  margin: "0 0 16px",
  lineHeight: 1.3,
};

const paragraph: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.55,
  color: "#404040",
  margin: "0 0 24px",
};

const link: React.CSSProperties = {
  color: "#0a0a0a",
  textDecoration: "underline",
};

const codeWrap: React.CSSProperties = {
  margin: "0 0 24px",
};

const codeText: React.CSSProperties = {
  display: "inline-block",
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", monospace',
  fontSize: 20,
  letterSpacing: "0.04em",
  color: "#0a0a0a",
  backgroundColor: "#fdfcf9",
  border: "1px solid #ddd8c9",
  borderRadius: 6,
  padding: "14px 18px",
  margin: 0,
};

const footnote: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.55,
  color: "#737373",
  margin: "32px 0 0",
};

const divider: React.CSSProperties = {
  borderColor: "#ddd8c9",
  margin: "32px 0 20px",
};

const legal: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.55,
  color: "#a3a3a3",
  margin: "0 0 8px",
};

const legalLink: React.CSSProperties = {
  color: "#737373",
  textDecoration: "underline",
};
