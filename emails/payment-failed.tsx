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

export type PaymentFailedEmailProps = {
  amount: string;
  nextAttempt: string | null;
  payUrl: string;
};

const LOGO_URL = "https://mogplex.com/email/mogplex-logo-black.png";
const SITE_URL = "https://mogplex.com";
const PRIVACY_URL = "https://mogplex.com/privacy";

export function PaymentFailedEmail({
  amount = "$20.00",
  nextAttempt = "October 12, 2026",
  payUrl = "https://invoice.stripe.com/i/preview",
}: PaymentFailedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your Mogplex payment of {amount} did not go through</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={logoSection}>
            <Img src={LOGO_URL} alt="Mogplex" width="165" height="36" style={logo} />
          </Section>

          <Text style={heading}>Your payment did not go through</Text>

          <Text style={paragraph}>
            We could not charge <strong>{amount}</strong> for your Mogplex
            subscription. Update your payment method to keep your plan active.
          </Text>

          <Text style={paragraph}>
            {nextAttempt
              ? `We will try the charge again on ${nextAttempt}.`
              : "We will not try this charge again automatically."}
          </Text>

          <Section style={buttonWrap}>
            <Button href={payUrl} style={button}>
              Update payment method
            </Button>
          </Section>

          <Text style={fallback}>
            Or paste this link in your browser:{" "}
            <Link href={payUrl} style={link}>
              {payUrl}
            </Link>
          </Text>

          <Text style={footnote}>
            If you already paid this invoice, you can ignore this email.
          </Text>

          <Hr style={divider} />

          <Section>
            <Text style={legal}>
              You&apos;re receiving this because you are the billing contact
              for a Mogplex subscription.
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

export default PaymentFailedEmail;

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
