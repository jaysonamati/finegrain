# Finegrain

An AI 2037 obsidian plugin as a knowledge interface.

## Getting started

### Linux

- Create a new vault
- `cd` into the vault directory and Create a .obsidian directory inside the  `mkdir .obsidian`
- `cd .obsidian && mkdir plugins`
- `git clone` this repository into the plugins directory
- `npm install && npm run dev` to build and run the plugin

## Usage

- Create a new note (markdown file) named `AI_Claims_Master`
- Add a bulleted list of all the claims you would like to investigate
- Create a new note to hold your investigables
 - This should be nested to represent finer nuances of an investigable
- On each list item of the investigable press `Ctrl + p` and Run the command `Link Nuance to Claim`
- This will allow you to link an investigable to a claim and also add a "justification" of why it is relevant to AI integration.
- A new note `AI_Relevances` will be created which will have a table to claims and AI integration relevances for each claim.


