"""Reuse existing founder-report exclusion policy for consistent live queries."""

import re

BUILTIN_EMAILS = ['zack@cartha.ai','zack@cartha.com','zackseyun@cartha.ai','zackseyun@cartha.com']

def sqlstr(value): return "'" + str(value).replace('\\','\\\\').replace("'", "\\'") + "'"

def clean_where(config):
    clauses=[]
    for k in ['is_test_traffic','analytics_exclude','exclude_from_analytics','internal_traffic','is_internal_traffic','internal_user','is_internal_user','is_staff']:
        clauses.append(f"lower(toString(coalesce(properties.{k}, 'false'))) NOT IN ('true','1','yes')")
    ids=config.get('excluded_ids', [])
    if ids:
        values=','.join(map(sqlstr,ids))
        for col in ['distinct_id','properties.user_id','properties.`$user_id`']:
            clauses.append(f"toString(coalesce({col}, '')) NOT IN ({values})")
    for k in ['email','$email','user_email']:
        clauses.append(f"lower(toString(coalesce(properties.`{k}`, ''))) NOT IN ({','.join(map(sqlstr,BUILTIN_EMAILS+config.get('excluded_emails',[])))})")
    for k in ['handle','username']:
        clauses.append(f"lower(toString(coalesce(properties.{k}, ''))) NOT IN ('zack','zackseyun','@zack','@zackseyun')")
    for k in ['device_model','$device_model','$model']:
        col=f"lower(toString(coalesce(properties.`{k}`, '')))"
        clauses.append(f"{col} NOT IN ('oneplus8pro','hry-lx1t')")
        clauses.append(f"(lower(toString(coalesce(properties.is_test_traffic, ''))) IN ('false','0','no') OR NOT match({col}, 'simulator|emulator|sdk_gphone|^arm64$|^x86_64$|^i386$'))")
    clauses.append("(lower(toString(coalesce(properties.is_test_traffic, ''))) IN ('false','0','no') OR lower(toString(coalesce(properties.is_physical_device, 'true'))) NOT IN ('false','0','no'))")
    clauses.append("match(lower(toString(coalesce(properties.`$host`, ''))), 'localhost|127[.]0[.]0[.]1|cloudfront[.]net') = 0")
    for k in ['$ip','ip','client_ip']:
        if config.get('excluded_ips'):
            # Fail closed on CIDRs until a network-aware SQL filter is implemented.
            if any('/' in v for v in config['excluded_ips']): raise ValueError('CIDR exclusion requires network-aware filter')
            clauses.append(f"toString(coalesce(properties.`{k}`, '')) NOT IN ({','.join(map(sqlstr,config['excluded_ips']))})")
    return ' AND '.join(clauses)
