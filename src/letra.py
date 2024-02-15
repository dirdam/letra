import re

class Transformer():
    '''Class to handle all transformations.'''
    json_dict_original = {} # Dictionary with all changes (with original names)
    json_dict = {} # Dictionary with all changes
    values_dict = {} # Dictionary of possible groups for a given letter/combination
    transformations_path = './transformations' # Path to existing transformations json
    transformations = [] # List of pairs (rule_name, result) to track the changes
    
    def __init__(self, json_dict={}, json_path='', auxiliary_groups_path=None):
        '''Initializes the json_dict based.
        - json_path='': str. Name of transformations json file.
        - auxiliary_groups_path: str. Path to auxiliary groups, such as IPA definitions.'''
        import copy
        # Load auxiliary groups
        if auxiliary_groups_path:
            aux_groups = self.load_json(auxiliary_groups_path)
        # Load main transformations json
        if json_path != '':
            self.json_path = f'{self.transformations_path}/{json_path}'
            self.json_dict = self.load_json(json_path=self.json_path)
        else:
            self.json_dict = self.load_json(json_dict=json_dict)
        self.json_dict_original = copy.deepcopy(self.json_dict)
        # Create new groups for '|' definitions in the rules (in case there are)
        self.add_rules_groups()
        # Expand groups
        self.expand_groups()
        # Rename groups
        self.rename_groups()
        # # Reverse groups
        # self.reverse_groups()
        # Convert json to regex
        self.json_to_regex()
    
    def load_json(self, json_dict={}, json_path=''):
        import json
        # Load and preprocess (remove) comments
        # print(json_dict)
        if json_path != '':
            with open(json_path, 'r', encoding='utf-8') as raw_file:
                json_content = re.sub(r'(?://[^\n]*)', '', raw_file.read())
        else:
            json_content = re.sub(r'(?://[^\n]*)', '', json_dict)
        # Load as json dict
        return json.loads(json_content)

    def add_rules_groups(self, temp_char='&&&'):
        '''Adds new groups for '|' definitions in the rules (in case there are)'''
        rules = self.json_dict['rules']
        keys_list = []
        # Check such groups
        for rule in rules:
            rule_keys = list(rules[rule].keys())
            group_keys = [rule for rule in rule_keys if '<' in rule] # Keys in rule that include '<'
            for key in group_keys:
                values = [v for v in self.split_values(key) if '|' in v] # Groups with '|'
                for value in values:
                    if value not in keys_list:
                        keys_list.append(value)

        # Add new groups (using `temp_char`; after expanding the groups will be re-replaced with '|')
        for new_key in keys_list:
            new_key_name = self.group_to_name(new_key)
            self.json_dict['groups'][new_key_name.replace('|', temp_char)] = [f'<{k}>' for k in new_key_name.split('|')]
    
    def expand_groups(self):
        '''Expands the groups in the dictionary'''        
        # Expand values (groups)
        expanded_groups = {}
        groups = self.json_dict['groups']
        for group_name in groups:
            value = []
            removals = []
            # Add letters and calls to groups
            for letter in groups[group_name]:
                if '!' in letter: # Negation
                    removals.append(letter[1:])
                elif '<' not in letter: # Fixed value
                    value += [letter]
                else: # Call existing group
                    key = letter[1:-1] # Remove `<` and `>`
                    value += expanded_groups[key]
            # Remove the undesired
            for letter in removals:
                if '<' not in letter: # Fixed value
                    value.remove(letter)
                else: # Call existing group
                    key = letter[1:-1] # Remove `<` and `>`
                    value = [v for v in value if v not in expanded_groups[key]]
            expanded_groups[group_name] = value
        
        self.json_dict['groups'] = expanded_groups

        # Expand keys
        expanded_groups = {}
        groups = self.json_dict['groups']
        for group_name in groups:
            for key in group_name.split('|'):
                expanded_groups[key] = groups[group_name]
        self.json_dict['groups'] = expanded_groups

    def rename_groups(self, temp_char='&&&'):
        '''Renames groups with `temp_char` back to `|` '''
        self.json_dict['groups'] = {key.replace(temp_char, '|'): value for key, value in self.json_dict['groups'].items()}
    
    def reverse_groups(self):
        '''Creates an inverted dictionary to look for letters and get the groups they may belong to.'''
        # Get unique values list
        values_list = [letter for group in self.json_dict['groups'].values() for letter in group]
        values_list = list(set(values_list))
        # Possibilities for each value
        values_dict = {}
        for value in values_list:
            values_dict[value] = []
            for group_name in self.json_dict['groups']:
                if value in self.json_dict['groups'][group_name]:
                    values_dict[value].append(group_name)
        self.values_dict = values_dict

    def json_to_regex(self):
        '''Converts json dictionary to regex.'''
        # Get groups
        groups = self.json_dict['groups']
        # print(groups)
        # Get rules
        rules = self.json_dict['rules']
        rules['iden'] = {'': ''} # Add identity rule
        # print(rules)
        # Convert groups to regex
        for group in groups:
            group_values = groups[group]
            group_values = [re.escape(value) for value in group_values]
            groups[group] = '(' + '|'.join(group_values) + ')' # (a|b|c), not ([a|b|c]) (in this case, all are interpreted as a single character, including the '|' character)
        # print(groups)
        # Convert rules to regex
        for rule in rules:
            regex_rules = {}
            rule_values = rules[rule]
            rule_values = self.replace_same(rule_values) # Replace same values with regex repetition notation
            for search_values, change_values in rule_values.items():
                search_values = self.convert_to_regex(search_values, groups) # Convert search_values to regex
                regex_rules[search_values] = change_values
            rules[rule] = regex_rules

    def replace_same(self, rule_values):
        '''Replaces same values in rule_values with regex repetition notation.'''
        for search_values, change_values in rule_values.items():
            regex_change = ''
            number_of_substitutions = 0
            search_values_list = re.findall(r'<([^>]*)>|([^<>]+)', search_values) # I don't use [^<>] to avoid escaping '<>'
            change_values_list = re.findall(r'<([^>]*)>|([^<>]+)', change_values)
            # print(search_values_list, change_values_list)
            if len(change_values_list) == 0: # If change_values_list is empty, make it actual list
                change_values_list = [('', '')]
            i = 0
            j = 0
            while i < len(search_values_list):
                search_value = search_values_list[i]
                change_value = change_values_list[j]
                # print(search_value, change_value, i, j)
                looped = False # Whether change_value had '' values
                if search_value[0] == '': # If search_value is char
                    regex_change += change_value[1]
                else: # If search_value is group
                    while change_value[0] == '': # If search_value is group and change_value is not, loop until change_value is group
                        regex_change += change_value[1]
                        j += 1
                        if j == len(change_values_list): # If change_values_list is over, stop
                            break
                        change_value = change_values_list[j]
                        looped = True
                    number_of_substitutions += 1
                    if search_value[0].replace('=', '') == change_value[0]:
                        regex_change += f'\\{number_of_substitutions}'
                    # else:
                    #     regex_change += f'<{change_value[0]}>' # This added <> for empty groups but it's not necessary
                i += 1
                if not looped:
                    j += 1
                if j >= len(change_values_list):
                    j = len(change_values_list) - 1
            rule_values[search_values] = regex_change
        return rule_values

    def convert_to_regex(self, key, groups):
        '''Converts a key to regex.'''
        key_parts = re.findall(r'<([^<>]+)>|([^<>]+)', key) # Group 1: group; Group 2: char
        result = ''
        for part in key_parts:
            if part[0] != '': # Group
                groups_keys = part[0].split('|')
                if len(groups_keys) > 1:
                    result += '('
                for group_key in groups_keys:
                    group_name = group_key.replace('*', '').replace('=', '') # Remove '*' and '='
                    # symbol = '+' if '*' in group_key else f"{{{1 + group_key.count('=')}}}" if '=' in group_key else '' # Replace adequate symbol
                    symbol = '+' if '*' in group_key else fr"\{group_key.count('=')}" if '=' in group_key else '' # Replace adequate symbol
                    result += groups[group_name].replace(')', f'){symbol}').replace('(', '(?:' if len(groups_keys) > 1 else '(') + '|' # Add group
                result = result[:-1]
                if len(groups_keys) > 1:
                    result += ')'
            else: # Char
                result += part[1]
        return result

    def transform_old(self, term, allow_identity=False, verbose=False):
        '''Applies the all the changes based on `rules` and `order`.
        `allow_indentity` sets whether the rules are compulsory in every step or whether the term can remain as identity.'''
        # new_terms = f' {term} ' # Set begining and end of term
        new_terms = [f' {term} '] # Set of possible outputs
        self.transformations = []
        steps = 0 # Number of steps (for verbose mode)
        for rules in self.json_dict['order']:
            rules = [rules] if '|' not in rules else rules.split('|')
            if allow_identity:
                rules = ['iden'] + rules # Add identity rule
            possible_terms = []
            for rule in rules:
                for middle_term in new_terms:
                    # print(rule, middle_term)
                    middle_term = self.apply_rule(rule, middle_term)
                    if middle_term not in possible_terms:
                        possible_terms.append(middle_term)
            # print(possible_terms)
            if possible_terms != new_terms:
                # print(rules)
                steps += 1
                if verbose:
                    print(f'{steps}.', [t[1:-1] for t in new_terms], f"--({'|'.join(rules)})->", [t[1:-1] for t in possible_terms]) # Remove begining and end of term (white spaces)
                new_terms = possible_terms
                self.transformations.append(('|'.join(rules), [t[1:-1] for t in new_terms]))
        return [t[1:-1] for t in new_terms]
        
    def transform(self, term, allow_identity=False, verbose=False):
        '''Applies the all the changes based on `rules` and `order`.
        `allow_indentity` sets whether the rules are compulsory in every step or whether the term can remain as identity.'''
        new_term = f' {term} ' # Set begining and end of term
        self.transformations = {new_term: {'mother': '', 'rule': ''}} # Dictionary of transformations {term: {'mother': mother_term, 'rule': rule}}
        nodes = [new_term] # Nodes (target words) to be transformed
        for rules in self.json_dict['order']:
            rules = [rules] if '|' not in rules else rules.split('|')
            if allow_identity:
                rules = ['iden'] + rules # Add identity rule
            last_nodes = [] # Last level of nodes
            for rule in rules:
                for middle_term in nodes: # For each term in the last level
                    transformed_middle_term = self.apply_rule(rule, middle_term)
                    if transformed_middle_term not in last_nodes: # If the new term is not yet registered as a last level node
                        last_nodes.append(transformed_middle_term)
                        if transformed_middle_term != middle_term and transformed_middle_term not in self.transformations: # If the transformation is different from the original term (to avoid adding the same term overriding the original one) and not in the transformations dictionary (to avoid loops like 'sello' -> 'sillo' -> 'sello' -> ...)
                            self.transformations[transformed_middle_term] = {'mother': middle_term, 'rule': rule}
                            if verbose:
                                print(f'{middle_term} --({rule})-> {transformed_middle_term}')
            nodes = last_nodes
        return last_nodes

    def apply_rule(self, rule_name, term):
        '''Applies specific rule to term.'''
        new_term = term
        changes = self.json_dict['rules'][rule_name]
        for search_values, change_values in changes.items():
            # print(search_values, change_values, new_term)
            new_term = re.sub(search_values, change_values, new_term)
        return new_term
        
    def split_values(self, values):
        '''Split values into chars and groups'''
        if '<' not in values:
            values = [values] # [char for char in values]
        else:
            parts = re.findall(r'<([^<>]*)>|([^<>]+)', values)
            values = [part[1] if (part[0] == '' and part[1] != '') else f'<{part[0]}>' for part in parts]
        return values
        
    def group_to_name(self, group_name):
        '''Removes brackets and other elements to get group pure name'''
        if '<' in group_name:
            group_name = group_name[1:-1]
            if '*' in group_name or '=' in group_name:
                group_name = group_name[:-1]
        return group_name