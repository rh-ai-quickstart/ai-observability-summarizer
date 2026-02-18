import * as React from 'react';
import {
  Modal,
  ModalVariant,
  Button,
  Form,
  FormGroup,
  DatePicker,
  TimePicker,
  Flex,
  FlexItem,
  Alert,
  AlertVariant,
} from '@patternfly/react-core';

interface CustomRangePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (startDate: Date, endDate: Date) => void;
}

export const CustomRangePickerModal: React.FC<CustomRangePickerModalProps> = ({
  isOpen,
  onClose,
  onApply,
}) => {
  const [startDate, setStartDate] = React.useState<string>('');
  const [startTime, setStartTime] = React.useState<string>('00:00');
  const [endDate, setEndDate] = React.useState<string>('');
  const [endTime, setEndTime] = React.useState<string>('00:00');
  const [validationError, setValidationError] = React.useState<string>('');

  // Initialize with simple defaults.
  React.useEffect(() => {
    if (isOpen) {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
      
      // Format dates for DatePicker (YYYY-MM-DD format required by HTML date inputs)
      const formatDate = (date: Date) => date.toLocaleDateString('en-CA');
      const formatTime = (date: Date) => `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      
      // Simple pattern: start = 1 hour ago, end = now.
      setStartDate(formatDate(oneHourAgo));
      setEndDate(formatDate(now));
      setStartTime(formatTime(oneHourAgo));
      setEndTime(formatTime(now)); // Always current time
      setValidationError('');
    } else {
      // Reset state when modal closes
      setStartDate('');
      setEndDate('');
      setStartTime('00:00');
      setEndTime('00:00');
      setValidationError('');
    }
  }, [isOpen]);

  // No complex time adjustment logic - keep it simple.
  // Users can manually adjust times as needed


  const validateAndApply = () => {
    setValidationError('');

    if (!startDate || !endDate) {
      setValidationError('Both start and end dates are required');
      return;
    }

    // Parse dates and times
    const startDateTime = new Date(`${startDate}T${startTime}`);
    const endDateTime = new Date(`${endDate}T${endTime}`);

    // Validation
    if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
      setValidationError('Invalid date or time format');
      return;
    }

    if (startDateTime >= endDateTime) {
      setValidationError('End date/time must be after start date/time');
      return;
    }

    // Check if range is too far in the future
    const now = new Date();
    if (endDateTime > now) {
      setValidationError('End date/time cannot be in the future');
      return;
    }

    // Check if range is reasonable (not too long)
    const diffDays = (endDateTime.getTime() - startDateTime.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 30) {
      setValidationError('Date range cannot exceed 30 days');
      return;
    }

    if (diffDays < 0.001) { // Less than ~1.5 minutes
      setValidationError('Date range must be at least a few minutes');
      return;
    }

    // Success - apply the range
    onApply(startDateTime, endDateTime);
    onClose();
  };

  const handleClose = () => {
    setValidationError('');
    onClose();
  };

  return (
    <Modal
      variant={ModalVariant.large}
      title="Custom Date Range"
      isOpen={isOpen}
      onClose={handleClose}
      position="top"
      hasNoBodyWrapper
      actions={[
        <Button
          key="apply"
          variant="primary"
          onClick={validateAndApply}
          isDisabled={!startDate || !endDate}
        >
          Apply Range
        </Button>,
        <Button key="cancel" variant="link" onClick={handleClose}>
          Cancel
        </Button>,
      ]}
    >
      <div style={{ padding: '24px', minHeight: '400px' }}>
      {validationError && (
        <Alert
          variant={AlertVariant.danger}
          title="Invalid Date Range"
          isInline
          style={{ marginBottom: '16px' }}
        >
          {validationError}
        </Alert>
      )}

      <Form>
        <FormGroup label="Start Date & Time" fieldId="start-date-time" style={{ marginBottom: '24px' }}>
          <Flex>
            <FlexItem flex={{ default: 'flex_2' }}>
              <DatePicker
                value={startDate}
                onChange={(_event, value) => setStartDate(value)}
                aria-label="Start date"
                placeholder="YYYY-MM-DD"
                appendTo={() => document.body}
                popoverProps={{
                  position: 'bottom',
                  enableFlip: true
                }}
              />
            </FlexItem>
            <FlexItem flex={{ default: 'flex_1' }} style={{ marginLeft: '8px' }}>
              <TimePicker
                time={startTime}
                onChange={(_event, value) => setStartTime(value)}
                is24Hour={true}
                aria-label="Start time"
              />
            </FlexItem>
          </Flex>
        </FormGroup>

        <FormGroup label="End Date & Time" fieldId="end-date-time" style={{ marginBottom: '24px' }}>
          <Flex>
            <FlexItem flex={{ default: 'flex_2' }}>
              <DatePicker
                value={endDate}
                onChange={(_event, value) => setEndDate(value)}
                aria-label="End date"
                placeholder="YYYY-MM-DD"
                appendTo={() => document.body}
                popoverProps={{
                  position: 'bottom',
                  enableFlip: true
                }}
              />
            </FlexItem>
            <FlexItem flex={{ default: 'flex_1' }} style={{ marginLeft: '8px' }}>
              <TimePicker
                time={endTime}
                onChange={(_event, value) => setEndTime(value)}
                is24Hour={true}
                aria-label="End time"
              />
            </FlexItem>
          </Flex>
        </FormGroup>
      </Form>

      <Alert
        variant={AlertVariant.info}
        title="Date Range Guidelines"
        isInline
        style={{ marginTop: '16px' }}
      >
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Maximum range: 30 days</li>
          <li>End time cannot be in the future</li>
          <li>Use 24-hour time format</li>
          <li>Minimum range: a few minutes</li>
        </ul>
      </Alert>
      </div>
    </Modal>
  );
};