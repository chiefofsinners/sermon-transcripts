#!/bin/bash
# Enable CORS on the GCS bucket so the browser can PUT files directly
# via signed URLs. Run once:
#   bash scripts/setup-gcs-cors.sh

BUCKET="${GCS_BUCKET_NAME:?GCS_BUCKET_NAME must be set}"

cat > /tmp/gcs-cors.json << 'EOF'
[
  {
    "origin": ["*"],
    "method": ["PUT"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
EOF

echo "Setting CORS on gs://$BUCKET ..."
gcloud storage buckets update "gs://$BUCKET" --cors-file=/tmp/gcs-cors.json
rm /tmp/gcs-cors.json
echo "Done."
