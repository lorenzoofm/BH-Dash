#!/bin/sh
# Prompts for the Airtable token without echoing it and saves it to the ignored .env.local.
printf 'Paste your Airtable token, then press Enter: '
stty -echo; IFS= read -r token; stty echo; echo
[ -n "$token" ] || { echo "No token entered."; exit 1; }
grep -v '^AIRTABLE_TOKEN=' .env.local 2>/dev/null > .env.local.tmp; printf 'AIRTABLE_TOKEN=%s\n' "$token" >> .env.local.tmp
mv .env.local.tmp .env.local; chmod 600 .env.local; echo "Saved to .env.local"
