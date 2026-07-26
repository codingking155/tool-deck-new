import styles from "../page.module.css";

type TechnicalDetailsSource = {
  detected_signals: string[];
  headers_sample?: Record<string, string>;
};

type TechnicalDetailsProps = {
  result: TechnicalDetailsSource;
  showTechnical: boolean;
  onToggle: () => void;
};

export const TechnicalDetails = ({ result, showTechnical, onToggle }: TechnicalDetailsProps) => (
  <div className={styles.technicalSection}>
    <button className={styles.technicalToggle} type="button" onClick={onToggle}>
      {showTechnical ? "Hide technical signals" : "Show technical signals"}
    </button>

    {showTechnical && (
      <div className={styles.technicalContent}>
        {result.detected_signals.length > 0 && (
          <div>
            <div className={styles.sectionTitle}>Detected Signals</div>
            <ul className={styles.signalList}>
              {result.detected_signals.map((signal) => (
                <li key={signal} className={styles.signalItem}>
                  {signal}
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.headers_sample && Object.keys(result.headers_sample).length > 0 && (
          <div>
            <div className={styles.sectionTitle}>Headers Sample</div>
            <ul className={styles.headersList}>
              {Object.entries(result.headers_sample).map(([header, value]) => (
                <li key={header} className={styles.headerItem}>
                  <strong>{header}:</strong> {value}
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.detected_signals.length === 0 &&
          (!result.headers_sample || Object.keys(result.headers_sample).length === 0) && (
            <p className={styles.helper}>No technical indicators were provided.</p>
          )}
      </div>
    )}
  </div>
);
