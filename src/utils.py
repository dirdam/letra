import json

sessions_file = 'data/sessions.json' # File to store the sessions' stats
def update_key(key, number=1):
    # Load the sessions' stats from a file
    try:
        with open(sessions_file, 'r') as file:
            json_file = json.load(file)
    except:
        json_file = {}

    # Update the key
    if key in json_file:
        json_file[key] += number
    else:
        json_file[key] = number

    # Save the updated file back
    with open(sessions_file, 'w') as file:
        json.dump(json_file, file)

def get_key(key):
    # Load the total games played so far from a file
    with open(sessions_file, 'r') as file:
        json_file = json.load(file)
        if key in json_file:
            return json_file[key]
        else:
            return 0