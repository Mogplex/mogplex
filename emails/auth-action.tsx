import {
  Body,
  Button,
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

export type AuthActionEmailProps = {
  heading: string;
  body: string;
  buttonLabel: string;
  actionUrl: string;
  footnote: string;
};

const LOGO_URL = "https://mogplex.com/email/mogplex-brandmark-black.png";
const SITE_URL = "https://mogplex.com";
const PRIVACY_URL = "https://mogplex.com/privacy";

export function AuthActionEmail({
  heading = "Verify your email",
  body: bodyCopy = "Confirm your email address to finish setting up your Mogplex account.",
  buttonLabel = "Verify email",
  actionUrl = "https://mogplex.com/auth/preview",
  footnote = "If you didn't request this, you can safely ignore this email.",
}: AuthActionEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{heading}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={logoSection}>
            <Img src={LOGO_URL} alt="Mogplex" width="190" height="30" style={logo} />
          </Section>

          <Text style={headingStyle}>{heading}</Text>

          <Text style={paragraph}>{bodyCopy}</Text>

          <Section style={buttonWrap}>
            <Button href={actionUrl} style={button}>
              {buttonLabel}
            </Button>
          </Section>

          <Text style={fallback}>
            Or paste this link in your browser:{" "}
            <Link href={actionUrl} style={link}>
              {actionUrl}
            </Link>
          </Text>

          <Text style={footnoteStyle}>{footnote}</Text>

          <Hr style={divider} />

          <Section>
            <Text style={legal}>
              You&apos;re receiving this because of a sign-in or account action
              on Mogplex.
            </Text>
            <Text style={legal}>
              Mogplex ·{" "}
              <Link href={SITE_URL} style={legalLink}>
                mogplex.com
              </Link>{" "}
              ·{" "}
              <Link href={PRIVACY_URL} style={legalLink}>
                Privacy
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default AuthActionEmail;

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

const logoSection: React.CSSProperties = { marginBottom: 32 };
const logo: React.CSSProperties = { display: "block" };

const headingStyle: React.CSSProperties = {
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

const buttonWrap: React.CSSProperties = { margin: "0 0 24px" };

const button: React.CSSProperties = {
  backgroundColor: "#ff4b00",
  color: "#ffffff",
  fontSize: 14,
  fontWeight: 500,
  padding: "12px 20px",
  borderRadius: 6,
  textDecoration: "none",
  display: "inline-block",
};

const fallback: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  color: "#737373",
  margin: "0 0 24px",
  wordBreak: "break-all",
};

const link: React.CSSProperties = { color: "#0a0a0a" };

const footnoteStyle: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  color: "#737373",
  margin: "0 0 32px",
};

const divider: React.CSSProperties = {
  borderColor: "#ddd8c9",
  margin: "0 0 16px",
};

const legal: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: "#a3a3a3",
  margin: "0 0 4px",
};

const legalLink: React.CSSProperties = {
  color: "#a3a3a3",
  textDecoration: "underline",
};
