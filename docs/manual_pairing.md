# Manual Pairing Procedure

## PC side

1. Open frontend and choose `PC Host`
2. Click `Create Offer`
3. Copy the offer JSON
4. Wait for mobile answer JSON
5. Paste answer JSON
6. Click `Apply Answer`
7. Confirm `pc.connection = connected`

## Mobile side

1. Open frontend and choose `Mobile Sensor`
2. Optional: click `Start Camera`
3. Paste the PC offer JSON
4. Click `Accept Offer / Create Answer`
5. Copy answer JSON back to PC
6. Wait for `mobile.connection = connected`
7. Click `Start Telemetry`

## Expected messages

- telemetry frame
- ping command
- ack response
- optional camera track

