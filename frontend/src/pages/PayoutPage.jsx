import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, EmptyState, LoadingState } from '../components/Feedback.jsx';
import { useWallet } from '../context/WalletContext.jsx';
import { formatAmount, formatDate } from '../hooks/useCurrencyFormat.js';
import api from '../services/api.js';

function isAvailable(item) {
  return item.active === true && item.availability === 'AVAILABLE';
}

function readableFieldName(field) {
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bUpi\b/gi, 'UPI')
    .replace(/\bId\b/gi, 'ID');
}

function createIdempotencyKey() {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('Secure request IDs are unavailable in this browser.');
  }
  return globalThis.crypto.randomUUID();
}

function PayoutPage() {
  const { refreshWallet } = useWallet();
  const [methods, setMethods] = useState([]);
  const [selectedMethodId, setSelectedMethodId] = useState('');
  const [options, setOptions] = useState([]);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [selectedOptionId, setSelectedOptionId] = useState('');
  const [payoutDetails, setPayoutDetails] = useState({});
  const [loadingMethods, setLoadingMethods] = useState(true);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [methodsError, setMethodsError] = useState('');
  const [optionsError, setOptionsError] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [withdrawal, setWithdrawal] = useState(null);
  const [refreshMessage, setRefreshMessage] = useState('');
  const idempotencyKeyRef = useRef(null);

  const availableMethods = useMemo(() => methods.filter(isAvailable), [methods]);
  const selectedMethod = methods.find((method) => method.methodId === selectedMethodId);
  const availableOptions = useMemo(() => options.filter(isAvailable), [options]);
  const selectedOption = availableOptions.find((option) => option.optionId === selectedOptionId);
  const requiredFields = useMemo(
    () =>
      [...new Set([
        ...(selectedMethod?.requiredDetails || []),
        ...(selectedOption?.requiredDetails || []),
      ])],
    [selectedMethod, selectedOption],
  );

  async function loadMethods() {
    setLoadingMethods(true);
    setMethodsError('');
    try {
      const result = await api.payoutMethods();
      const methodList = Array.isArray(result.methods) ? result.methods : [];
      setMethods(methodList);
      setSelectedMethodId((current) => {
        if (methodList.some((method) => method.methodId === current && isAvailable(method))) {
          return current;
        }
        return methodList.find(isAvailable)?.methodId || '';
      });
    } catch (error) {
      setMethodsError(error.message);
    } finally {
      setLoadingMethods(false);
    }
  }

  useEffect(() => {
    void loadMethods();
  }, []);

  useEffect(() => {
    if (!selectedMethodId) {
      setOptions([]);
      setSelectedOptionId('');
      setLoadingOptions(false);
      return undefined;
    }

    let active = true;
    setLoadingOptions(true);
    setOptionsError('');
    setSelectedOptionId('');
    setPayoutDetails({});
    idempotencyKeyRef.current = null;
    api
      .payoutOptions(selectedMethodId)
      .then((result) => {
        if (active) {
          setOptions(Array.isArray(result.options) ? result.options : []);
        }
      })
      .catch((error) => {
        if (active) {
          setOptionsError(error.message);
        }
      })
      .finally(() => {
        if (active) {
          setLoadingOptions(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedMethodId, optionsRetry]);

  function chooseMethod(methodId) {
    setSelectedMethodId(methodId);
    setFormError('');
    setWithdrawal(null);
    setRefreshMessage('');
  }

  function chooseOption(optionId) {
    setSelectedOptionId(optionId);
    setPayoutDetails({});
    setFormError('');
    setWithdrawal(null);
    setRefreshMessage('');
    idempotencyKeyRef.current = null;
  }

  function updatePayoutDetail(field, value) {
    setPayoutDetails((current) => ({ ...current, [field]: value }));
    setFormError('');
    setWithdrawal(null);
    setRefreshMessage('');
    idempotencyKeyRef.current = null;
  }

  function reviewWithdrawal(event) {
    event.preventDefault();
    setFormError('');
    if (!selectedMethod || !selectedOption) {
      setFormError('Choose an available payout method and denomination.');
      return;
    }
    const missingField = requiredFields.find(
      (field) => typeof payoutDetails[field] !== 'string' || !payoutDetails[field].trim(),
    );
    if (missingField) {
      setFormError(`${readableFieldName(missingField)} is required.`);
      return;
    }
    setShowConfirmation(true);
  }

  async function submitWithdrawal() {
    setSubmitting(true);
    setFormError('');
    try {
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = createIdempotencyKey();
      }
      const result = await api.createWithdrawal({
        method: selectedMethod.methodId,
        optionId: selectedOption.optionId,
        payoutDetails,
        idempotencyKey: idempotencyKeyRef.current,
      });
      setWithdrawal(result.withdrawal);
      setShowConfirmation(false);
      idempotencyKeyRef.current = null;
      setPayoutDetails({});
      const refreshed = await refreshWallet(1);
      setRefreshMessage(
        refreshed
          ? 'Your wallet balance and transaction history are up to date.'
          : 'Your request was submitted. Open Wallet and refresh to load the latest balance.',
      );
    } catch (error) {
      setFormError(error.message);
      setShowConfirmation(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingMethods) {
    return <LoadingState label="Loading payout methods…" />;
  }

  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">Redeem rewards</p>
          <h1>Payout</h1>
          <p className="muted-copy">
            Select an available payout option. The server verifies all values and eligibility.
          </p>
        </div>
        <Link className="button button-secondary" to="/wallet">Back to wallet</Link>
      </section>

      {methodsError ? (
        <Alert>
          <span>{methodsError} </span>
          <button className="alert-action" type="button" onClick={() => void loadMethods()}>
            Try again
          </button>
        </Alert>
      ) : null}

      {availableMethods.length === 0 ? (
        <section className="panel">
          <EmptyState title="Payout is not available right now">
            Payout methods are controlled by the backend and no method is currently available.
            Please check again later.
          </EmptyState>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Step 1</p>
                <h2>Choose a payout method</h2>
              </div>
            </div>
            <div className="choice-grid method-grid">
              {methods.map((method) => {
                const available = isAvailable(method);
                return (
                  <button
                    className={`choice-card ${method.methodId === selectedMethodId ? 'choice-selected' : ''}`}
                    key={method.methodId}
                    type="button"
                    disabled={!available}
                    onClick={() => chooseMethod(method.methodId)}
                  >
                    <span className="choice-title">{method.name}</span>
                    <span className={`availability ${available ? 'availability-open' : ''}`}>
                      {available ? 'Available' : 'Unavailable'}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {selectedMethod ? (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Step 2</p>
                  <h2>Choose a denomination</h2>
                </div>
              </div>

              {loadingOptions ? <LoadingState label="Loading available options…" /> : null}
              {optionsError ? (
                <Alert>
                  <span>{optionsError} </span>
                  <button
                    className="alert-action"
                    type="button"
                    onClick={() => setOptionsRetry((attempt) => attempt + 1)}
                  >
                    Retry
                  </button>
                </Alert>
              ) : null}
              {!loadingOptions && !optionsError && availableOptions.length === 0 ? (
                <EmptyState title="No denominations available">
                  This method is active, but there are no currently available options.
                </EmptyState>
              ) : null}
              {availableOptions.some((option) => option.metadata?.referenceOnly) ? (
                <p className="muted-copy">
                  These assignment reference values require manual review. This demo does not
                  connect to a payment provider.
                </p>
              ) : null}

              {!loadingOptions && availableOptions.length > 0 ? (
                <div className="choice-grid denomination-grid">
                  {availableOptions.map((option) => (
                    <button
                      className={`choice-card denomination-card ${option.optionId === selectedOptionId ? 'choice-selected' : ''}`}
                      key={option.optionId}
                      type="button"
                      onClick={() => chooseOption(option.optionId)}
                    >
                      <span className="choice-title">
                        {option.name || `${formatAmount(option.payoutAmount)} ${option.payoutCurrency}`}
                      </span>
                      <span className="choice-subtitle">
                        {formatAmount(option.payoutAmount)} {option.payoutCurrency}
                      </span>
                      <span className="muted-copy">
                        Requires {formatAmount(option.requiredAmount)} {option.currency}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {selectedOption ? (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Step 3</p>
                  <h2>Payout details</h2>
                </div>
                <span className="selection-summary">
                  {formatAmount(selectedOption.payoutAmount)} {selectedOption.payoutCurrency}
                </span>
              </div>

              <form className="form-stack payout-form" onSubmit={reviewWithdrawal}>
                {requiredFields.length ? (
                  <div className="detail-fields">
                    {requiredFields.map((field) => (
                      <label className="field" key={field}>
                        <span>{readableFieldName(field)}</span>
                        <input
                          type={field.toLowerCase().includes('email') ? 'email' : 'text'}
                          autoComplete="off"
                          name={field}
                          value={payoutDetails[field] || ''}
                          onChange={(event) => updatePayoutDetail(field, event.target.value)}
                          required
                        />
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="muted-copy">
                    This payout option does not require additional account details.
                  </p>
                )}
                <Alert>{formError}</Alert>
                <button className="button button-primary" type="submit">
                  Review redemption
                </button>
              </form>
            </section>
          ) : null}
        </>
      )}

      {withdrawal ? (
        <section className="success-card" aria-live="polite">
          <div className="success-icon" aria-hidden="true">✓</div>
          <div>
            <p className="eyebrow">Request submitted</p>
            <h2>Redemption is pending</h2>
            <p className="muted-copy">
              Withdrawal {withdrawal.withdrawalId} · {formatDate(withdrawal.requestedAt)}
            </p>
            <span className="status-badge status-pending">{withdrawal.status}</span>
            {refreshMessage ? <p className="success-note">{refreshMessage}</p> : null}
            <Link className="inline-link" to="/wallet">View updated wallet and transactions</Link>
          </div>
        </section>
      ) : null}

      {showConfirmation && selectedOption ? (
        <div className="dialog-backdrop">
          <section
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <p className="eyebrow">Final review</p>
            <h2 id="confirm-title">Confirm redemption?</h2>
            <p className="muted-copy">
              The required wallet amount is supplied by the backend configuration and will be
              deducted immediately when your request is accepted.
            </p>
            <dl className="confirmation-details">
              <div>
                <dt>Payout</dt>
                <dd>{formatAmount(selectedOption.payoutAmount)} {selectedOption.payoutCurrency}</dd>
              </div>
              <div>
                <dt>Required</dt>
                <dd>
                  {formatAmount(selectedOption.requiredAmount)} {selectedOption.currency}
                </dd>
              </div>
              <div>
                <dt>Method</dt>
                <dd>{selectedMethod?.name}</dd>
              </div>
            </dl>
            {formError ? <Alert>{formError}</Alert> : null}
            <div className="dialog-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={submitting}
                onClick={() => setShowConfirmation(false)}
              >
                Go back
              </button>
              <button
                className="button button-primary"
                type="button"
                disabled={submitting}
                onClick={() => void submitWithdrawal()}
              >
                {submitting ? 'Submitting…' : 'Confirm redemption'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default PayoutPage;
