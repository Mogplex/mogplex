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

export type TeamInviteEmailProps = {
  teamName: string;
  inviterName: string | null;
  role: "admin" | "developer" | "viewer";
  acceptUrl: string;
};

const LOGO_URL = "https://mogplex.com/email/mogplex-logo-black.png";
const SITE_URL = "https://mogplex.com";
const PRIVACY_URL = "https://mogplex.com/privacy";

export function TeamInviteEmail({
  teamName = "Acme",
  inviterName = "A teammate",
  role = "developer",
  acceptUrl = "https://mogplex.com/invite/preview",
}: TeamInviteEmailProps) {
  const inviter = inviterName || "A teammate";
  return (
    <Html>
      <Head />
      <Preview>
        {inviter} invited you to join {teamName} on Mogplex
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={logoSection}>
            <Img src={LOGO_URL} alt="Mogplex" width="165" height="36" style={logo} />
          </Section>

          <Text style={heading}>
            Join {teamName} on Mogplex
          </Text>

          <Text style={paragraph}>
            {inviter} invited you to join <strong>{teamName}</strong> as a{" "}
            <strong>{role}</strong>. Click below to accept and start
            collaborating.
          </Text>

          <Section style={buttonWrap}>
            <Button href={acceptUrl} style={button}>
              Accept invitation
            </Button>
          </Section>

          <Text style={fallback}>
            Or paste this link in your browser:{" "}
            <Link href={acceptUrl} style={link}>
              {acceptUrl}
            </Link>
          </Text>

          <Text style={footnote}>
            This invitation expires in 7 days. If you weren&apos;t expecting it,
            you can safely ignore this email.
          </Text>

          <Hr style={divider} />

          <Section>
            <Text style={legal}>
              You&apos;re receiving this because someone invited you to a team
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

export default TeamInviteEmail;

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

const link: React.CSSProperties = {
  color: "#0a0a0a",
  textDecoration: "underline",
  wordBreak: "break-all",
};

const fallback: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  color: "#737373",
  margin: "0 0 24px",
};

const footnote: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.55,
  color: "#737373",
  margin: "0",
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
