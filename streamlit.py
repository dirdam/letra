import streamlit as st
from io import StringIO
import pandas as pd
import src.letra as letra
import src.utils as utils

# Load language dictionary
def load_bundle(lang):
    # Load in the text bundle and filter by language.
    df = pd.read_csv('data/localizations.csv')
    df = df[df['lang'] == lang]
    # Create and return a dictionary of key/values.
    lang_dict = {df['key'].to_list()[i]:df['value'].to_list()[i] for i in range(len(df['key'].to_list()))}
    return lang_dict

st.set_page_config(
    page_title="LETRA: LanguagE TRAnsformations",
    page_icon="🔀",
    layout="wide",
    initial_sidebar_state="auto",
    menu_items={
        'Get help': "https://dirdam.github.io/contact.html",
        'About': f"""This app was proudly developed by [Adrián Jiménez Pascual](https://dirdam.github.io/).
        
- This app has been used **`{utils.get_key('sessions'):,}`** times.
- A total of **`{utils.get_key('terms'):,}`** terms have been transformed so far."""
    })

# Title
st.markdown("# LETRA: LanguagE TRAnsformations")

# Sidebar
lang_options = {
    'Español': 'es',
    'English': 'en'
}
with st.sidebar:
    lang = st.selectbox('Select language', list(lang_options.keys()))
    lang_dict = load_bundle(lang_options[lang])
    st.markdown(lang_dict['how_to_use'])
    st.markdown(lang_dict['how_to_use_explain'])

# Main content
tool_tab, project_tab = st.tabs([lang_dict['tool'], lang_dict['pj_desc']])
with project_tab:
    with open(f'data/LETRA_{lang_options[lang]}.md', 'r', encoding='utf-8') as file:
        content = file.read()
    st.markdown(content)

existing_files = {'sample.json': lang_dict['use_sample'], 'LA_ES.json': lang_dict['use_la_es'], 'ES_IPA.json': lang_dict['use_es_ipa'], 'own': lang_dict['upload_own']}
with tool_tab:
    st.markdown(lang_dict['upload_text'])
    upload_choice = st.selectbox(lang_dict['upload_options'], list(existing_files.keys()), format_func=lambda x: existing_files[x])
    if upload_choice in existing_files and upload_choice != 'own':
        json_file = upload_choice
        t = letra.Transformer(json_path=json_file)
    else: # If a file is uploaded, use it
        json_file = st.file_uploader(lang_dict['upload_desc'], type='json')
        if json_file:
            content = StringIO(json_file.getvalue().decode("utf-8")).read()
            t = letra.Transformer(content)
        else:
            st.stop()

    st.markdown(lang_dict['enter_text'])
    # If active user, add session count
    if upload_choice != 'sample.json' and 'session_registered' not in st.session_state:
        utils.update_key('sessions')
        st.session_state.session_registered = True

    if upload_choice != 'own':
        extra_ref = '' if upload_choice != 'LA_ES.json' else lang_dict['explain_ref']
        st.markdown(lang_dict['accent_explain'] + ' ' + extra_ref)

    if json_file == 'sample.json': # Change placeholders and values for the input text
        placeholder = 'lítteram'
        value = 'lítteram'
    elif json_file == 'LA_ES.json':
        placeholder = 'lítteram, trophaéum, óperam, dóminum, quinquagínta, dígitum...'
        value = ''
    elif json_file == 'ES_IPA.json':
        placeholder = 'civilización, chascarríllo, halagüéño, verdád, rejuvenecér, wáter...'
        value = ''
    else:
        placeholder = lang_dict['placeholder']
        value = ''

    term = st.text_input(lang_dict['text_input'], value=value, placeholder=placeholder).lower()
    if 'last_term' not in st.session_state or st.session_state.last_term != term: # If a new term is introduced
        st.session_state.last_term = None # Initialize last term everytime a new term is introduced
        st.session_state.last_clicked = None # Initialize last clicked everytime a new term is introduced
        if len(term) > 0 and 'session_registered' in st.session_state: # If actual term and active session
            utils.update_key('terms') # Add term to the count

    def line_from_term(step_term, transformed_terms, t):
        rule_name = transformed_terms[step_term]['rule']
        if rule_name == '':
            return '', '', ''
        rule_field = []
        r = t.json_dict_original['rules'][rule_name]
        for k in r:
            rule_field.append(f'"{k}" → "{r[k]}"')
        mother_term = transformed_terms[step_term]['mother']
        return rule_name, ' & '.join(rule_field), mother_term

    if term:
        st.markdown(lang_dict['trans_result'])
        last_nodes = t.transform(term, verbose=False)
        transformed_terms = t.transformations
        # Show all terms if requested
        get_all_intermediate_terms = st.checkbox(lang_dict['interm_check'])
        last_nodes = list(transformed_terms.keys()) if get_all_intermediate_terms else last_nodes
        # Clickable terms which show transformations
        data = []
        cols_nums = 4
        for i in range(0, len(last_nodes), cols_nums):
            cols = st.columns(cols_nums)
            for col, step_term in zip(cols, last_nodes[i:i+cols_nums]):
                if col.button(step_term, use_container_width=True, disabled=False if step_term != f' {term} ' else True, type='primary' if step_term == st.session_state.last_clicked else 'secondary'): # Transformed terms as buttons (disable original term)
                    if st.session_state.last_clicked != step_term: # Marked as clicked and rerun (to show color)
                        st.session_state.last_clicked = step_term
                        st.rerun()
                if st.session_state.last_clicked == step_term: # If during rerun the button appears as clicked
                    while step_term != f' {term} ': # Fill data with transformations while not reaching the original term
                        rule_name, rule_field, mother_term = line_from_term(step_term, transformed_terms, t)
                        data.append([rule_name, rule_field, mother_term, step_term])
                        step_term = mother_term
        if st.session_state.last_clicked and len(data) > 0: # If there is a term to show
            st.markdown(lang_dict['chain_result'])
            data = data[::-1] # Reverse transformations
            indices = [i+1 for i in range(len(data))] # Create indices to begin from 1
            columns = [lang_dict['col2'], lang_dict['col3'], lang_dict['col4'], lang_dict['col5']]
            df = pd.DataFrame(data, columns=columns)
            df.index = indices
            st.table(df)
        st.session_state.last_term = term # Register used term

    st.markdown("---")
    st.markdown(lang_dict['check_json'])
    chosen_file = json_file.name if upload_choice == 'own' else json_file
    aux_col1, col, aux_col2 = st.columns([1, 1, 1])
    with col:
        with open(f'transformations/{chosen_file}') as f:
            st.download_button(lang_dict['download_json'] + f"`{chosen_file}`", f, file_name=chosen_file, use_container_width=True)  # Defaults to 'text/plain'
    with st.expander(lang_dict['json_content'] + f"`{chosen_file}`."):
        st.write(t.json_dict_original)